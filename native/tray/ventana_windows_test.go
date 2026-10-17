package main

import (
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// lanzarSinElevar debe poder arrancar un programa con el token del escritorio y
// pasarle los argumentos. cmd.exe /c exit 7 termina con código 7: así se
// comprueba que se lanzó y que los argumentos llegaron, sin abrir ninguna ventana.
func TestLanzarSinElevarPasaLosArgumentos(t *testing.T) {
	pid, err := lanzarSinElevar(`C:\Windows\System32\cmd.exe`, []string{"/c", "exit", "7"})
	if err != nil {
		t.Skipf("no hay Explorador o falta el privilegio en este entorno: %v", err)
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, pid)
	if err != nil {
		// El proceso ya terminó y Windows lo liberó: no se puede confirmar el código.
		t.Skipf("el proceso ya no existe: %v", err)
	}
	defer windows.CloseHandle(h)
	if ev, _ := windows.WaitForSingleObject(h, 5000); ev != windows.WAIT_OBJECT_0 {
		t.Fatal("el proceso no terminó a tiempo")
	}
	var codigo uint32
	if err := windows.GetExitCodeProcess(h, &codigo); err != nil || codigo != 7 {
		t.Fatalf("código de salida %d (%v); se esperaba 7", codigo, err)
	}
	_ = time.Second
}

func TestProcesoVivoReconoceAlPropioProceso(t *testing.T) {
	if !procesoVivo(int(windows.GetCurrentProcessId())) {
		t.Error("el proceso actual debe estar vivo")
	}
	if procesoVivo(0x7ffffff0) {
		t.Error("un PID inexistente no debe estar vivo")
	}
}
