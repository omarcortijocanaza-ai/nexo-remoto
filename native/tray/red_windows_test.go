package main

import (
	"strings"
	"testing"
	"time"
)

func TestAnalizarSalidaRedAceptaListasYObjetosSueltos(t *testing.T) {
	// PowerShell 5.1 escribe un elemento solo como objeto, no como lista.
	suelto := `{"perfiles":{"nombre":"Red 3","interfaz":"Ethernet","categoria":"Public"},"todasPublicas":true,` +
		`"reglasPublicas":{"nombre":"Node.js JavaScript Runtime","programa":"C:\\Program Files\\nodejs\\node.exe","protocolo":"TCP"},"reglasNexo":3,"reglaHttps":false,"cerradas":0}`
	red, _, err := analizarSalidaRed(suelto, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(red.Perfiles) != 1 || red.Perfiles[0].Categoria != "Public" || !red.TodasPublicas {
		t.Fatalf("perfiles: %+v", red)
	}
	if len(red.ReglasPublicas) != 1 || red.ReglasPublicas[0].Protocolo != "TCP" || red.ReglasNexo != 3 || red.PuertoHTTPS != puertoHTTPSLan || !red.Elevado {
		t.Fatalf("reglas: %+v", red)
	}

	lista := `{"perfiles":[{"nombre":"A","interfaz":"Wi-Fi","categoria":"Private"},{"nombre":"B","interfaz":"Ethernet","categoria":"Public"}],"todasPublicas":false,"reglasPublicas":[],"reglasNexo":3,"reglaHttps":true,"cerradas":2}`
	red, cerradas, err := analizarSalidaRed("\xef\xbb\xbf"+lista, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(red.Perfiles) != 2 || red.TodasPublicas || len(red.ReglasPublicas) != 0 || !red.ReglaHTTPS || cerradas != 2 || red.Elevado {
		t.Fatalf("lista: %+v cerradas=%d", red, cerradas)
	}

	vacio, _, err := analizarSalidaRed(`{"perfiles":null,"reglasPublicas":null,"todasPublicas":false}`, true)
	if err != nil || vacio.Perfiles == nil || vacio.ReglasPublicas == nil {
		t.Fatalf("null debe dar listas vacías (el JSON de la interfaz no admite null): %+v %v", vacio, err)
	}
	if _, _, err := analizarSalidaRed("sin datos", true); err == nil {
		t.Fatal("una respuesta sin JSON debe dar error")
	}
}

func TestScriptRedEscapaLasRutas(t *testing.T) {
	s := scriptRed("leer", `C:\Users\O'Brien\node.exe`, `D:\nexo remoto`)
	if !strings.Contains(s, `'C:\Users\O''Brien\node.exe'`) {
		t.Fatalf("las comillas simples deben duplicarse en PowerShell:\n%s", s)
	}
	for _, accion := range []string{"leer", "privada", "cerrar", "https"} {
		if !strings.Contains(scriptRed(accion, "n", "r"), "$accion = '"+accion+"'") {
			t.Fatalf("falta la acción %s", accion)
		}
	}
}

func TestAnalizarTurnNuncaDevuelveNullEnLasListas(t *testing.T) {
	t1, err := analizarTurn(`{"proveedor":"ninguno","cloudflareKeyId":"","tieneApiToken":false,"manualUrls":null,"manualUsuario":"","tieneCredencial":false}`)
	if err != nil || t1.ManualURLs == nil {
		t.Fatalf("manualUrls null debe volverse lista vacía: %+v %v", t1, err)
	}
	if _, err := analizarTurn("no es json"); err == nil {
		t.Fatal("un JSON roto debe dar error")
	}
}

// Lee de verdad el estado de la red y el firewall de esta PC (sólo lectura): comprueba que el script
// corre en PowerShell 5.1 y que su JSON se entiende.
func TestScriptRedLeerEnEstaPC(t *testing.T) {
	nodo, _ := rutaNode()
	salida, err := ejecutarPowerShell(90*time.Second, scriptRed("leer", nodo, `D:\nexo-remoto`))
	if err != nil {
		t.Fatalf("PowerShell: %v", err)
	}
	red, _, err := analizarSalidaRed(salida, false)
	if err != nil {
		t.Fatalf("%v\n%s", err, salida)
	}
	if !red.Comprobado {
		t.Fatalf("debía quedar comprobado: %+v", red)
	}
	t.Logf("redes: %+v · reglas públicas de NEXO: %d · reglas NEXO: %d · regla HTTPS: %v", red.Perfiles, len(red.ReglasPublicas), red.ReglasNexo, red.ReglaHTTPS)
}
