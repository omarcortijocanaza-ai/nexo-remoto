package main

// Utilidades para lanzar y matar procesos sin que aparezca ninguna ventana de
// consola (la bandeja es un programa «windowsgui»: un hijo de consola abriría
// una ventana negra si no se le pide lo contrario).

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// ocultar configura cmd para que no cree ventana. CREATE_NO_WINDOW evita la
// consola; HideWindow cubre además a los hijos con ventana propia. No se usa
// con explorer.exe, que sí debe mostrarse.
func ocultar(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW,
	}
}

// rutaNode busca node.exe en el PATH y, si no está, en la ruta de instalación
// estándar.
func rutaNode() (string, error) {
	if p, err := exec.LookPath("node"); err == nil {
		return p, nil
	}
	const defecto = `C:\Program Files\nodejs\node.exe`
	if _, err := os.Stat(defecto); err == nil {
		return defecto, nil
	}
	return "", errors.New("no se encontró node.exe (ni en PATH ni en C:\\Program Files\\nodejs)")
}

// proceso envuelve un hijo ya arrancado. Hecho se cierra cuando termina y
// Codigo queda fijado antes de cerrarlo, de modo que varios lectores pueden
// esperar a la vez sin competir por un único valor.
type proceso struct {
	cmd    *exec.Cmd
	inicio time.Time
	Hecho  chan struct{}
	Codigo int
}

// lanzarOculto arranca un hijo oculto con stdin/stdout/stderr a NUL (cmd.Stdin,
// Stdout y Stderr en nil equivalen a os.DevNull) y espera su fin en segundo plano.
func lanzarOculto(dir string, env []string, exe string, args ...string) (*proceso, error) {
	cmd := exec.Command(exe, args...)
	cmd.Dir = dir
	if env != nil {
		cmd.Env = env
	}
	ocultar(cmd)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	p := &proceso{cmd: cmd, inicio: time.Now(), Hecho: make(chan struct{})}
	go func() {
		err := cmd.Wait()
		p.Codigo = 0
		if err != nil {
			var ee *exec.ExitError
			if errors.As(err, &ee) {
				p.Codigo = ee.ExitCode()
			} else {
				p.Codigo = -1
			}
		}
		close(p.Hecho)
	}()
	return p, nil
}

func (p *proceso) Pid() int { return p.cmd.Process.Pid }

// terminado dice si el proceso ya salió.
func (p *proceso) terminado() bool {
	select {
	case <-p.Hecho:
		return true
	default:
		return false
	}
}

// matarArbol ejecuta `taskkill /PID <pid> /T /F` (el árbol entero, porque el
// lanzador tiene hijos propios).
func matarArbol(pid int) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
	ocultar(cmd)
	return cmd.Run()
}

// dormir espera d o hasta que se cancele ctx; devuelve false si se canceló.
func dormir(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
