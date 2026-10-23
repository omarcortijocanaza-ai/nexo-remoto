package main

// Lista de dispositivos con acceso, para la vista «Dispositivos» del panel. Se lee de
// <stateDir>\.nexo-devices.json, que escribe el servidor Node (device-manager.js). El panel SOLO LEE
// y SOLO devuelve la etiqueta y las fechas: el id y el hash de cada cookie nunca salen de este archivo.
// Quitar el acceso a un dispositivo lo hace el servidor (no se toca el archivo desde aquí: Node lo
// reescribe mientras corre y pisarlo desde otro proceso lo corrompería).

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode"
)

const (
	nombreArchivoDispositivos = ".nexo-devices.json"
	maxEtiquetaDispositivo    = 60
)

// DispositivoPanel es lo único que sabe el panel de cada dispositivo (GET /api/dispositivos).
type DispositivoPanel struct {
	Etiqueta  string `json:"etiqueta"`
	UltimaVez int64  `json:"ultimaVez"` // milisegundos desde 1970 (como Date.now())
	Creado    int64  `json:"creado"`
}

func rutaDispositivos(stateDir string) string {
	return filepath.Join(stateDir, nombreArchivoDispositivos)
}

// limpiarEtiqueta quita caracteres de control y recorta: es texto que vino de un navegador remoto.
func limpiarEtiqueta(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > maxEtiquetaDispositivo {
		s = strings.TrimSpace(string(r[:maxEtiquetaDispositivo]))
	}
	if s == "" {
		return "Dispositivo"
	}
	return s
}

// leerDispositivos nunca falla: sin archivo o roto, no hay dispositivos. Descarta los caducados y
// ordena del visto más recientemente al más antiguo.
func leerDispositivos(ruta string, ahora time.Time) []DispositivoPanel {
	salida := []DispositivoPanel{}
	datos, err := os.ReadFile(ruta)
	if err != nil {
		return salida
	}
	var archivo struct {
		Devices []struct {
			Label     string `json:"label"`
			CreatedAt int64  `json:"createdAt"`
			LastSeen  int64  `json:"lastSeen"`
			ExpiresAt int64  `json:"expiresAt"`
		} `json:"devices"`
	}
	if json.Unmarshal(datos, &archivo) != nil {
		return salida
	}
	ms := ahora.UnixMilli()
	for _, d := range archivo.Devices {
		if d.ExpiresAt <= ms {
			continue
		}
		salida = append(salida, DispositivoPanel{Etiqueta: limpiarEtiqueta(d.Label), UltimaVez: d.LastSeen, Creado: d.CreatedAt})
	}
	sort.SliceStable(salida, func(i, j int) bool { return salida[i].UltimaVez > salida[j].UltimaVez })
	return salida
}
