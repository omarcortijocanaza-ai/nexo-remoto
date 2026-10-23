package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func crearRuntimeFalso(t *testing.T, root string, nombres ...string) []string {
	t.Helper()
	var dirs []string
	for _, nombre := range nombres {
		dir := filepath.Join(root, "runtime", nombre)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, nombre+".exe"), nil, 0o600); err != nil {
			t.Fatal(err)
		}
		dirs = append(dirs, dir)
	}
	return dirs
}

func TestBundledRuntimePrioridadYOverrides(t *testing.T) {
	for _, override := range []bool{false, true} {
		t.Run(map[bool]string{false: "incluidos", true: "overrides"}[override], func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "NEXO con espacios")
			dirs := crearRuntimeFalso(t, root, "node", "pwsh", "ffmpeg", "cloudflared")
			previo := `C:\Otro Node;C:\Windows\System32;C:\Otro Node`
			env := map[string]string{"PATH": previo}
			if override {
				env["NEXO_FFMPEG"] = `X:\FFmpeg elegido\ffmpeg.exe`
				env["CLOUDFLARED_PATH"] = `X:\Túnel elegido\cloudflared.exe`
			}
			setenv := func(k, v string) error { env[k] = v; return nil }
			for i := 0; i < 2; i++ {
				if err := prepararRuntimeIncluido(root, func(k string) string { return env[k] }, setenv); err != nil {
					t.Fatal(err)
				}
			}
			if want := strings.Join(dirs, ";") + ";" + previo; env["PATH"] != want {
				t.Fatalf("PATH = %q, esperado %q", env["PATH"], want)
			}
			for variable, nombre := range map[string]string{"NEXO_FFMPEG": "ffmpeg", "CLOUDFLARED_PATH": "cloudflared"} {
				want := filepath.Join(root, "runtime", nombre, nombre+".exe")
				if override {
					want = map[string]string{"NEXO_FFMPEG": `X:\FFmpeg elegido\ffmpeg.exe`, "CLOUDFLARED_PATH": `X:\Túnel elegido\cloudflared.exe`}[variable]
				}
				if env[variable] != want {
					t.Fatalf("%s = %q, esperado %q", variable, env[variable], want)
				}
			}
		})
	}
}

func TestBundledRuntimeFallbackYParcial(t *testing.T) {
	root := t.TempDir()
	env := map[string]string{"PATH": `C:\Herramientas`, "NEXO_FFMPEG": "custom"}
	getenv := func(k string) string { return env[k] }
	setenv := func(k, v string) error { env[k] = v; return nil }
	want := map[string]string{"PATH": env["PATH"], "NEXO_FFMPEG": "custom"}
	if err := prepararRuntimeIncluido(root, getenv, setenv); err != nil || !reflect.DeepEqual(env, want) {
		t.Fatalf("sin bundle debe conservar entorno: %v %v", env, err)
	}
	// Una carpeta con nombre de exe no es un componente utilizable.
	if err := os.MkdirAll(filepath.Join(root, "runtime", "ffmpeg", "ffmpeg.exe"), 0o700); err != nil {
		t.Fatal(err)
	}
	dirs := crearRuntimeFalso(t, root, "node")
	if err := prepararRuntimeIncluido(root, getenv, setenv); err != nil {
		t.Fatal(err)
	}
	want["PATH"] = dirs[0] + ";" + want["PATH"]
	if !reflect.DeepEqual(env, want) {
		t.Fatalf("bundle parcial: %v, esperado %v", env, want)
	}
	delete(env, "PATH")
	if err := prepararRuntimeIncluido(root, getenv, setenv); err != nil || env["PATH"] != dirs[0] {
		t.Fatalf("sin PATH: %v %v", env, err)
	}
	fail := errors.New("fallo setenv")
	if err := prepararRuntimeIncluido(root, getenv, func(string, string) error { return fail }); !errors.Is(err, fail) {
		t.Fatalf("debe propagar el error: %v", err)
	}
}

func TestBundledRuntimeResolucionSinNodeInstalado(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Aplicación portable")
	dirs := crearRuntimeFalso(t, root, "node", "pwsh", "ffmpeg", "cloudflared")
	// Sólo cambia el entorno del ejecutable de tests, y t.Setenv lo restaura.
	// LookPath comprueba la resolución real sin ejecutar los archivos ficticios.
	t.Setenv("PATH", "")
	t.Setenv("PATHEXT", ".EXE")
	t.Setenv("NEXO_FFMPEG", "")
	t.Setenv("CLOUDFLARED_PATH", "")
	if err := prepararRuntimeIncluido(root, os.Getenv, os.Setenv); err != nil {
		t.Fatal(err)
	}
	for i, nombre := range []string{"node", "pwsh", "ffmpeg", "cloudflared"} {
		got, err := exec.LookPath(nombre)
		want := filepath.Join(dirs[i], nombre+".exe")
		if err != nil || !strings.EqualFold(got, want) {
			t.Fatalf("LookPath(%s) = %q, %v; esperado %q", nombre, got, err, want)
		}
	}
}
