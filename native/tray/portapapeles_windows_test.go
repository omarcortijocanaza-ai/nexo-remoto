package main

import (
	"os"
	"testing"
)

// Prueba de ida y vuelta del portapapeles. Está desactivada por defecto porque
// pisa el contenido del portapapeles del usuario; se activa con
// NEXO_TRAY_TEST_CLIPBOARD=1 (y restaura el texto anterior si lo había).
func TestPortapapelesIdaYVuelta(t *testing.T) {
	if os.Getenv("NEXO_TRAY_TEST_CLIPBOARD") != "1" {
		t.Skip("define NEXO_TRAY_TEST_CLIPBOARD=1 para probar el portapapeles real")
	}
	previo, errPrevio := leerPortapapeles()
	if errPrevio == nil {
		defer copiarAlPortapapeles(previo)
	}
	const texto = "https://ejemplo.trycloudflare.com/?token=ñandú-✓-prueba"
	if err := copiarAlPortapapeles(texto); err != nil {
		t.Fatal(err)
	}
	got, err := leerPortapapeles()
	if err != nil {
		t.Fatal(err)
	}
	if got != texto {
		t.Errorf("leído %q, quiero %q", got, texto)
	}
}
