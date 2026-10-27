package main

import (
	"testing"
	"time"
)

// En una sesión de escritorio la barra de tareas existe; en un servicio o CI sin
// escritorio no, y la prueba no tiene nada que comprobar.
func TestBarraDeTareasEnEscritorio(t *testing.T) {
	if !barraDeTareasLista() {
		t.Skip("sin barra de tareas (sesión sin escritorio)")
	}
	inicio := time.Now()
	if !esperarBarraDeTareas(time.Second) {
		t.Fatal("la barra existe pero esperarBarraDeTareas devolvió false")
	}
	if d := time.Since(inicio); d > 5*time.Second {
		t.Fatalf("la espera con la barra ya lista tardó %v", d)
	}
}

func TestPermitirAvisoDeBarra(t *testing.T) {
	if err := permitirAvisoDeBarra(); err != nil {
		t.Fatalf("ChangeWindowMessageFilter falló: %v", err)
	}
}
