package main

// Registro propio de la bandeja: logsDir\nexo-tray.log, texto plano. Sólo
// eventos (arranque, relanzados, errores). Nunca se escriben enlaces ni el
// token; quien llame a Printf es responsable de no pasarlos.

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const tamanoMaxRegistro = 1 << 20 // 1 MiB

type Registro struct {
	mu sync.Mutex
	f  *os.File
}

// abrirRegistro abre (o crea) nexo-tray.log. Si ya pasa de 1 MiB lo renombra a
// nexo-tray.log.1 (descartando el anterior) para que no crezca sin límite.
func abrirRegistro(dir string) (*Registro, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	ruta := filepath.Join(dir, "nexo-tray.log")
	if st, err := os.Stat(ruta); err == nil && st.Size() > tamanoMaxRegistro {
		_ = os.Remove(ruta + ".1")
		_ = os.Rename(ruta, ruta+".1")
	}
	f, err := os.OpenFile(ruta, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, err
	}
	return &Registro{f: f}, nil
}

// Printf escribe una línea con marca de tiempo. Es seguro llamarlo sobre un
// *Registro nil (no hace nada), así el programa sigue aunque no haya log.
func (r *Registro) Printf(formato string, args ...any) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		return
	}
	fmt.Fprintf(r.f, "%s %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(formato, args...))
}

func (r *Registro) Cerrar() {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f != nil {
		r.f.Close()
		r.f = nil
	}
}
