package main

// Ajustes que guarda el panel en <stateDir>\.nexo-settings.json y que el
// lanzador (lib/settings.js) lee al arrancar. Mismas reglas que en Node: lo
// ausente o inválido toma el valor por defecto al LEER; al ESCRIBIR desde el
// panel se valida de forma estricta y se rechaza con un mensaje claro.

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

const (
	nombreArchivoAjustes = ".nexo-settings.json"
	maxMicDispositivo    = 80
)

// Ajustes es el contenido del archivo y del contrato del panel.
type Ajustes struct {
	Modo           string `json:"modo"` // both | local | remote
	GPU            bool   `json:"gpu"`
	MicDispositivo string `json:"micDispositivo"`
}

var ajustesPorDefecto = Ajustes{Modo: "both", GPU: true, MicDispositivo: "CABLE Input"}

func modoValido(m string) bool { return m == "both" || m == "local" || m == "remote" }

func rutaAjustes(stateDir string) string { return filepath.Join(stateDir, nombreArchivoAjustes) }

// leerAjustes es indulgente: archivo ausente, roto o con campos inválidos →
// valores por defecto en lo que falte.
func leerAjustes(ruta string) Ajustes {
	salida := ajustesPorDefecto
	datos, err := os.ReadFile(ruta)
	if err != nil {
		return salida
	}
	var crudo struct {
		Modo           *string `json:"modo"`
		GPU            *bool   `json:"gpu"`
		MicDispositivo *string `json:"micDispositivo"`
	}
	if json.Unmarshal(datos, &crudo) != nil {
		return salida
	}
	if crudo.Modo != nil && modoValido(*crudo.Modo) {
		salida.Modo = *crudo.Modo
	}
	if crudo.GPU != nil {
		salida.GPU = *crudo.GPU
	}
	if crudo.MicDispositivo != nil {
		if mic := recortarMic(*crudo.MicDispositivo); mic != "" {
			salida.MicDispositivo = mic
		}
	}
	return salida
}

func recortarMic(s string) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) > maxMicDispositivo {
		r = r[:maxMicDispositivo]
	}
	return strings.TrimSpace(string(r))
}

// validarAjustes comprueba lo que llega del panel y lo devuelve normalizado.
func validarAjustes(a Ajustes) (Ajustes, error) {
	if !modoValido(a.Modo) {
		return a, errors.New("El modo debe ser «local + Internet», «sólo local» o «sólo Internet».")
	}
	mic := strings.TrimSpace(a.MicDispositivo)
	if mic == "" {
		mic = ajustesPorDefecto.MicDispositivo
	}
	if len([]rune(mic)) > maxMicDispositivo {
		return a, fmt.Errorf("El nombre del cable virtual no puede pasar de %d caracteres.", maxMicDispositivo)
	}
	for _, r := range mic {
		if unicode.IsControl(r) {
			return a, errors.New("El nombre del cable virtual tiene caracteres no válidos.")
		}
	}
	a.MicDispositivo = mic
	return a, nil
}

// guardarAjustes escribe de forma atómica (temporal + renombrar): un corte a
// mitad no deja el archivo truncado.
func guardarAjustes(ruta string, a Ajustes) error {
	datos, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return err
	}
	return escribirAtomico(ruta, append(datos, '\n'))
}

func escribirAtomico(ruta string, datos []byte) error {
	if err := os.MkdirAll(filepath.Dir(ruta), 0o700); err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.tmp-%d", ruta, os.Getpid())
	if err := os.WriteFile(tmp, datos, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, ruta); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}
