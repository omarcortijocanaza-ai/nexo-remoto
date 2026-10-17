package main

// Configuración del aviso del enlace al celular: %APPDATA%\NEXO\nexo-aviso.conf,
// el mismo archivo que lee scripts\windows\nexo-avisar-enlace.ps1 (CLAVE=valor,
// «#» para comentarios). El panel sólo toca sus claves y conserva el resto.

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Aviso es la parte editable del archivo.
type Aviso struct {
	Metodo        string // ninguno | ntfy | telegram
	NtfyServidor  string
	NtfyTema      string
	TelegramToken string
	TelegramChat  string
}

func rutaAviso() string { return filepath.Join(os.Getenv("APPDATA"), "NEXO", "nexo-aviso.conf") }

var (
	reClaveConf   = regexp.MustCompile(`^\s*([A-Z_]+)\s*=\s*(.*?)\s*$`)
	reTemaNtfy    = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}$`)
	reChatTelegr  = regexp.MustCompile(`^-?[0-9]{1,20}$`)
	reTokenTelegr = regexp.MustCompile(`^[0-9]{5,15}:[A-Za-z0-9_-]{20,80}$`)
)

// clavesAviso: orden y nombre de las claves que gestiona el panel.
var clavesAviso = []string{"NEXO_AVISO", "NTFY_SERVIDOR", "NTFY_TEMA", "TELEGRAM_TOKEN", "TELEGRAM_CHAT"}

func parsearAviso(texto string) Aviso {
	valores := map[string]string{}
	for _, linea := range strings.Split(strings.ReplaceAll(texto, "\r\n", "\n"), "\n") {
		if strings.HasPrefix(strings.TrimSpace(linea), "#") {
			continue
		}
		if m := reClaveConf.FindStringSubmatch(linea); m != nil {
			valores[m[1]] = strings.Trim(m[2], `"'`)
		}
	}
	a := Aviso{
		Metodo:        valores["NEXO_AVISO"],
		NtfyServidor:  valores["NTFY_SERVIDOR"],
		NtfyTema:      valores["NTFY_TEMA"],
		TelegramToken: valores["TELEGRAM_TOKEN"],
		TelegramChat:  valores["TELEGRAM_CHAT"],
	}
	if a.Metodo != "ntfy" && a.Metodo != "telegram" {
		a.Metodo = "ninguno"
	}
	if a.NtfyServidor == "" {
		a.NtfyServidor = "https://ntfy.sh"
	}
	return a
}

func leerAviso(ruta string) Aviso {
	datos, err := os.ReadFile(ruta)
	if err != nil {
		return parsearAviso("")
	}
	return parsearAviso(string(datos))
}

// validarAviso comprueba lo que llega del panel. `conservarToken` indica que el
// token de Telegram viene vacío a propósito (se mantiene el que ya hay).
func validarAviso(a Aviso, conservarToken bool) error {
	switch a.Metodo {
	case "ninguno":
		return nil
	case "ntfy":
		if !strings.HasPrefix(a.NtfyServidor, "https://") && !strings.HasPrefix(a.NtfyServidor, "http://") {
			return errors.New("La dirección del servidor ntfy debe empezar por https://")
		}
		if strings.ContainsAny(a.NtfyServidor, " \t\r\n\"'") {
			return errors.New("La dirección del servidor ntfy no es válida.")
		}
		if !reTemaNtfy.MatchString(a.NtfyTema) {
			return errors.New("El tema de ntfy sólo puede llevar letras, números, punto, guion y guion bajo (hasta 100). Usa uno largo y secreto.")
		}
	case "telegram":
		if !reChatTelegr.MatchString(a.TelegramChat) {
			return errors.New("El id del chat de Telegram debe ser un número (puede empezar por -).")
		}
		if !(conservarToken && a.TelegramToken == "") && !reTokenTelegr.MatchString(a.TelegramToken) {
			return errors.New("El token del bot de Telegram no tiene el formato esperado (123456789:ABC…).")
		}
	default:
		return errors.New("El método de aviso debe ser ninguno, ntfy o Telegram.")
	}
	return nil
}

// renderizarAviso devuelve el texto nuevo: actualiza las claves conocidas donde
// ya estaban, añade al final las que faltaban y conserva comentarios y claves
// ajenas (NEXO_AVISO_ESPERA, etc.).
func renderizarAviso(existente string, a Aviso) string {
	nuevos := map[string]string{
		"NEXO_AVISO":     a.Metodo,
		"NTFY_SERVIDOR":  a.NtfyServidor,
		"NTFY_TEMA":      a.NtfyTema,
		"TELEGRAM_TOKEN": a.TelegramToken,
		"TELEGRAM_CHAT":  a.TelegramChat,
	}
	escritas := map[string]bool{}
	var salida []string
	if strings.TrimSpace(existente) != "" {
		for _, linea := range strings.Split(strings.TrimRight(strings.ReplaceAll(existente, "\r\n", "\n"), "\n"), "\n") {
			if !strings.HasPrefix(strings.TrimSpace(linea), "#") {
				if m := reClaveConf.FindStringSubmatch(linea); m != nil {
					if v, ok := nuevos[m[1]]; ok {
						if !escritas[m[1]] {
							salida = append(salida, m[1]+"="+v)
							escritas[m[1]] = true
						}
						continue
					}
				}
			}
			salida = append(salida, linea)
		}
	} else {
		salida = append(salida, "# Configuración del aviso del enlace (la escribe el panel de NEXO).")
	}
	for _, clave := range clavesAviso {
		if !escritas[clave] {
			salida = append(salida, clave+"="+nuevos[clave])
		}
	}
	return strings.Join(salida, "\r\n") + "\r\n"
}

// guardarAviso escribe el archivo. Con `conservarToken` y token vacío mantiene el actual.
func guardarAviso(ruta string, a Aviso, conservarToken bool) error {
	if err := validarAviso(a, conservarToken); err != nil {
		return err
	}
	existente, _ := os.ReadFile(ruta)
	if conservarToken && a.TelegramToken == "" {
		a.TelegramToken = parsearAviso(string(existente)).TelegramToken
	}
	return escribirAtomico(ruta, []byte(renderizarAviso(string(existente), a)))
}
