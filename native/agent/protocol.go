//go:build windows

package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/go-ole/go-ole"
)

var stdoutMu sync.Mutex

func writeJSONLine(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error serializando JSON: %v\n", err)
		return
	}
	stdoutMu.Lock()
	defer stdoutMu.Unlock()
	os.Stdout.Write(data)
	os.Stdout.Write([]byte{'\n'})
}

type rawRequest struct {
	ID         any      `json:"id"`
	Op         string   `json:"op"`
	Action     string   `json:"action"`
	X          *int     `json:"x"`
	Y          *int     `json:"y"`
	DX         *float64 `json:"dx"`
	DY         *float64 `json:"dy"`
	Button     string   `json:"button"`
	Text       *string  `json:"text"`
	Events     []keyEv  `json:"events"`
	Target     any      `json:"target"`
	On         *bool    `json:"on"`
}

func sendOK(id any, fields map[string]any) {
	out := make(map[string]any, len(fields)+2)
	for k, v := range fields {
		out[k] = v
	}
	out["id"] = id
	out["ok"] = true
	writeJSONLine(out)
}

func sendErr(id any, msg string) {
	writeJSONLine(map[string]any{
		"id":    id,
		"ok":    false,
		"error": msg,
	})
}

func runServe(dpiAware bool) {
	stdinClosed := make(chan struct{})
	startKeepAwakeWorker()

	writeJSONLine(map[string]any{
		"event":    "ready",
		"version":  agentVersion,
		"dpiAware": dpiAware,
		"elevated": currentProcessElevated(),
		"session":  currentSessionID(),
		"user":     currentUserName(),
	})

	startSessionMonitors(stdinClosed)

	lineCh := make(chan []byte, 64)
	go func() {
		reader := bufio.NewReaderSize(os.Stdin, 64*1024)
		for {
			line, err := reader.ReadBytes('\n')
			if len(line) > 0 {
				trimmed := bytes.TrimSpace(line)
				if len(trimmed) > 0 {
					cp := make([]byte, len(trimmed))
					copy(cp, trimmed)
					lineCh <- cp
				}
			}
			if err != nil {
				if err != io.EOF {
					fmt.Fprintf(os.Stderr, "Error leyendo stdin: %v\n", err)
				}
				close(stdinClosed)
				close(lineCh)
				// Si hay una operación bloqueada cuando se cierra stdin, garantiza la salida rápida.
				time.AfterFunc(400*time.Millisecond, func() {
					os.Exit(0)
				})
				return
			}
		}
	}()

	// Hilo único bloqueado con COM inicializado para atender todas las peticiones en orden.
	done := make(chan struct{})
	go func() {
		runtime.LockOSThread()
		attachDefaultDesktop()
		_ = ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED)
		defer ole.CoUninitialize()
		defer close(done)

		for raw := range lineCh {
			handleRequestLine(raw, stdinClosed)
		}
	}()

	<-done
	os.Exit(0)
}

func handleRequestLine(raw []byte, stdinClosed <-chan struct{}) {
	var req rawRequest
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "Pánico recuperado en petición: %v\n", r)
			sendErr(req.ID, fmt.Sprintf("Error interno del agente: %v", r))
		}
	}()

	if err := json.Unmarshal(raw, &req); err != nil {
		sendErr(nil, "JSON de petición inválido")
		return
	}

	// Re-adjuntar al escritorio de entrada actual por si cambió tras desbloqueo.
	attachDefaultDesktop()

	switch req.Op {
	case "ping":
		sendOK(req.ID, nil)

	case "monitors":
		mons, virt, err := queryMonitors()
		if err != nil {
			sendErr(req.ID, err.Error())
			return
		}
		sendOK(req.ID, map[string]any{
			"monitors": mons,
			"virtual":  virt,
		})

	case "pointer":
		if req.X == nil || req.Y == nil {
			sendErr(req.ID, "Coordenadas x, y requeridas en pointer")
			return
		}
		if err := handlePointer(req.Action, *req.X, *req.Y, req.Button); err != nil {
			sendErr(req.ID, err.Error())
			return
		}
		sendOK(req.ID, nil)

	case "scroll":
		if req.X == nil || req.Y == nil {
			sendErr(req.ID, "Coordenadas x, y requeridas en scroll")
			return
		}
		dx := 0.0
		dy := 0.0
		if req.DX != nil {
			dx = *req.DX
		}
		if req.DY != nil {
			dy = *req.DY
		}
		if err := handleScroll(*req.X, *req.Y, dx, dy); err != nil {
			sendErr(req.ID, err.Error())
			return
		}
		sendOK(req.ID, nil)

	case "text":
		if req.Text == nil {
			sendErr(req.ID, "Parámetro text requerido")
			return
		}
		if err := handleText(*req.Text); err != nil {
			sendErr(req.ID, err.Error())
			return
		}
		sendOK(req.ID, nil)

	case "keys":
		if err := handleKeys(req.Events); err != nil {
			sendErr(req.ID, err.Error())
			return
		}
		sendOK(req.ID, nil)

	case "clipboard.get":
		text, err := getClipboardText()
		if err != nil {
			sendErr(req.ID, err.Error())
			return
		}
		sendOK(req.ID, map[string]any{"text": text})

	case "clipboard.set":
		t := ""
		if req.Text != nil {
			t = *req.Text
		}
		if err := setClipboardText(t); err != nil {
			sendErr(req.ID, err.Error())
			return
		}
		sendOK(req.ID, nil)

	case "desktop.info":
		info := getDesktopInfo()
		sendOK(req.ID, map[string]any{
			"supported": info.Supported,
			"index":     info.Index,
			"count":     info.Count,
		})

	case "desktop.switch":
		idx, err := switchDesktop(req.Target, stdinClosed)
		if err != nil {
			sendErr(req.ID, err.Error())
			return
		}
		sendOK(req.ID, map[string]any{"index": idx})

	case "foreground":
		fg := getForegroundInfo()
		sendOK(req.ID, map[string]any{
			"title":    fg.Title,
			"process":  fg.Process,
			"elevated": fg.Elevated,
		})

	case "keepawake":
		on := false
		if req.On != nil {
			on = *req.On
		}
		setKeepAwake(on)
		sendOK(req.ID, nil)

	case "desktop.state":
		sendOK(req.ID, map[string]any{"state": getDesktopState()})

	default:
		sendErr(req.ID, fmt.Sprintf("Operación desconocida: %s", req.Op))
	}
}
