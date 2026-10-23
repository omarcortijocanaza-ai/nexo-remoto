package main

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegistroConservaErroresDeBibliotecas(t *testing.T) {
	dir := t.TempDir()
	r, err := abrirRegistro(dir)
	if err != nil {
		t.Fatal(err)
	}
	r.Printf("arranque del panel")
	log.New(r, "systray: ", 0).Print("no se pudo registrar el icono")
	r.Cerrar()
	datos, err := os.ReadFile(filepath.Join(dir, "nexo-tray.log"))
	if err != nil {
		t.Fatal(err)
	}
	for _, texto := range []string{"arranque del panel", "systray: no se pudo registrar el icono"} {
		if !strings.Contains(string(datos), texto) {
			t.Errorf("no se conservó %q", texto)
		}
	}
}
