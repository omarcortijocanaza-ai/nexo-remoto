package main

import (
	"os"
	"path/filepath"
	"strings"
)

// Sólo se anuncian componentes presentes: un checkout sin runtime conserva
// las búsquedas anteriores. getenv/setenv permiten probar sin alterar el entorno real.
func prepararRuntimeIncluido(root string, getenv func(string) string, setenv func(string, string) error) error {
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	var dirs []string
	for _, componente := range []struct{ nombre, variable string }{
		{"node", ""}, {"pwsh", ""}, {"ffmpeg", "NEXO_FFMPEG"}, {"cloudflared", "CLOUDFLARED_PATH"},
	} {
		bin := filepath.Join(root, "runtime", componente.nombre, componente.nombre+".exe")
		info, err := os.Stat(bin)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		dirs = append(dirs, filepath.Dir(bin))
		if componente.variable != "" && getenv(componente.variable) == "" {
			if err := setenv(componente.variable, bin); err != nil {
				return err
			}
		}
	}
	if len(dirs) == 0 {
		return nil
	}
	// Quitar duplicados propios mantiene la prioridad incluso si el padre ya
	// preparó el entorno, conservando el resto del PATH y sus espacios.
	previo := getenv("PATH")
	componentes := len(dirs)
	if previo != "" {
		for _, dir := range strings.Split(previo, string(os.PathListSeparator)) {
			incluido := false
			for _, bundled := range dirs[:componentes] {
				if strings.EqualFold(filepath.Clean(dir), bundled) {
					incluido = true
					break
				}
			}
			if !incluido {
				dirs = append(dirs, dir)
			}
		}
	}
	return setenv("PATH", strings.Join(dirs, string(os.PathListSeparator)))
}
