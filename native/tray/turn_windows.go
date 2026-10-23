package main

// TURN desde el panel. La validación y la lectura/escritura de `.nexo-turn.json` viven en Node
// (lib/ice.js + scripts/turn-config.js) para tener una sola implementación; aquí sólo se llama a esos
// scripts. Los secretos (token de Cloudflare, contraseña del TURN) viajan por stdin, nunca por la
// línea de órdenes, y las respuestas nunca los llevan.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

func (o *operaciones) LeerTurn() (TurnPanel, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd, err := o.nodeCmd(ctx, filepath.Join("scripts", "turn-config.js"), "get")
	if err != nil {
		return TurnPanel{}, err
	}
	var salida, errores bytes.Buffer
	cmd.Stdout, cmd.Stderr = &salida, &errores
	if err := cmd.Run(); err != nil {
		return TurnPanel{}, fmt.Errorf("No se pudo leer la configuración del TURN: %s", textoDeError(errores.String(), err))
	}
	return analizarTurn(salida.String())
}

func analizarTurn(texto string) (TurnPanel, error) {
	var t TurnPanel
	if err := json.Unmarshal([]byte(strings.TrimSpace(texto)), &t); err != nil {
		return TurnPanel{}, errors.New("La configuración del TURN tiene un formato inesperado.")
	}
	if t.ManualURLs == nil {
		t.ManualURLs = []string{}
	}
	return t, nil
}

func (o *operaciones) GuardarTurn(t TurnEntrada) (TurnPanel, error) {
	cuerpo := map[string]any{
		"proveedor":       t.Proveedor,
		"cloudflare":      map[string]any{"keyId": strings.TrimSpace(t.Cloudflare.KeyID), "apiToken": strings.TrimSpace(t.Cloudflare.APIToken)},
		"manual":          map[string]any{"urls": t.Manual.URLs, "usuario": strings.TrimSpace(t.Manual.Usuario), "credencial": strings.TrimSpace(t.Manual.Credencial)},
		"olvidarSecretos": t.OlvidarSecretos,
	}
	datos, err := json.Marshal(cuerpo)
	if err != nil {
		return TurnPanel{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	cmd, err := o.nodeCmd(ctx, filepath.Join("scripts", "turn-config.js"), "set")
	if err != nil {
		return TurnPanel{}, err
	}
	cmd.Stdin = bytes.NewReader(datos)
	var salida, errores bytes.Buffer
	cmd.Stdout, cmd.Stderr = &salida, &errores
	if err := cmd.Run(); err != nil {
		// El script ya redactó el motivo en español (campos que faltan, direcciones mal escritas…).
		return TurnPanel{}, errors.New(textoDeError(errores.String(), err))
	}
	panel, err := analizarTurn(salida.String())
	if err != nil {
		return TurnPanel{}, err
	}
	o.a.log.Printf("panel: TURN configurado (%s)", panel.Proveedor)
	return panel, nil
}

// ProbarTurn pide credenciales de verdad y comprueba que el TURN ofrece una ruta de retransmisión.
func (o *operaciones) ProbarTurn() (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd, err := o.nodeCmd(ctx, filepath.Join("scripts", "turn-test.js"), "--json")
	if err != nil {
		return "", err
	}
	var salida, errores bytes.Buffer
	cmd.Stdout, cmd.Stderr = &salida, &errores
	_ = cmd.Run() // el código de salida lo repite el JSON; si no hay JSON se explica abajo
	var r struct {
		OK      bool   `json:"ok"`
		Mensaje string `json:"mensaje"`
	}
	if json.Unmarshal(bytes.TrimSpace(salida.Bytes()), &r) != nil || r.Mensaje == "" {
		return "", fmt.Errorf("La prueba del TURN no respondió: %s", textoDeError(errores.String(), errors.New("sin respuesta")))
	}
	if !r.OK {
		return "", errors.New(r.Mensaje)
	}
	o.a.log.Printf("panel: prueba del TURN correcta")
	return r.Mensaje, nil
}

// textoDeError prefiere lo que el script escribió en stderr; si no hay nada, el error del sistema.
func textoDeError(stderr string, err error) string {
	if msg := limpiarSalida(stderr); msg != "" {
		return msg
	}
	return err.Error()
}
