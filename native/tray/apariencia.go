package main

// Apariencia que eligió el dueño (tema y claro/oscuro), guardada en
// <stateDir>\.nexo-apariencia.json. La escribe el panel y la lee el servidor Node
// (lib/apariencia.js) en cada petición de página, así que cambiarla NO obliga a reiniciar NEXO.
// Las reglas de validación son idénticas en Go y en Node (docs/diseno/ESPECIFICACION.md § 4):
// al LEER, lo ausente o inválido toma el valor por defecto campo por campo y nunca es un error;
// al ESCRIBIR desde el panel se valida de forma estricta y se rechaza con un mensaje claro.

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

const nombreArchivoApariencia = ".nexo-apariencia.json"

// temasValidos son los ids exactos de las cinco apariencias (también son los nombres de temas/<id>.css).
var temasValidos = []string{"cabina", "nativa", "reymuerto", "cianotipo", "bloque"}

// Apariencia es el contenido del archivo y del contrato de /api/apariencia.
type Apariencia struct {
	Tema string `json:"tema"` // uno de temasValidos
	Modo string `json:"modo"` // auto | claro | oscuro («auto» sigue a prefers-color-scheme de cada dispositivo)
	// PorDispositivo=false: todos los dispositivos usan Tema. true: cada dispositivo puede elegir
	// la suya (se recuerda en su navegador) y Tema sólo es el valor inicial.
	PorDispositivo bool `json:"porDispositivo"`
}

// Rey Muerto (Viego) es la apariencia por defecto, la del dueño.
var aparienciaPorDefecto = Apariencia{Tema: "reymuerto", Modo: "auto", PorDispositivo: false}

func temaValido(t string) bool {
	for _, v := range temasValidos {
		if t == v {
			return true
		}
	}
	return false
}

func modoAparienciaValido(m string) bool { return m == "auto" || m == "claro" || m == "oscuro" }

func rutaApariencia(stateDir string) string {
	return filepath.Join(stateDir, nombreArchivoApariencia)
}

// leerApariencia es indulgente: archivo ausente o roto → valores por defecto; un campo con un
// valor desconocido o de otro tipo → el valor por defecto de ese campo y se respetan los demás.
func leerApariencia(ruta string) Apariencia {
	salida := aparienciaPorDefecto
	datos, err := os.ReadFile(ruta)
	if err != nil {
		return salida
	}
	var crudo map[string]any
	if json.Unmarshal(datos, &crudo) != nil {
		return salida
	}
	if t, ok := crudo["tema"].(string); ok && temaValido(t) {
		salida.Tema = t
	}
	if m, ok := crudo["modo"].(string); ok && modoAparienciaValido(m) {
		salida.Modo = m
	}
	if b, ok := crudo["porDispositivo"].(bool); ok {
		salida.PorDispositivo = b
	}
	return salida
}

// validarApariencia comprueba lo que llega del panel (estricto, a diferencia de leerApariencia).
func validarApariencia(a Apariencia) (Apariencia, error) {
	if !temaValido(a.Tema) {
		return a, errors.New("Esa apariencia no existe: elige Cabina, Nativa, Rey Muerto, Cianotipo o Bloque.")
	}
	if !modoAparienciaValido(a.Modo) {
		return a, errors.New("El modo debe ser automático, claro u oscuro.")
	}
	return a, nil
}

// guardarApariencia escribe de forma atómica (temporal + renombrar): el servidor Node puede leer
// el archivo en cualquier momento y nunca debe encontrarlo a medias.
func guardarApariencia(ruta string, a Apariencia) error {
	datos, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return err
	}
	return escribirAtomico(ruta, append(datos, '\n'))
}
