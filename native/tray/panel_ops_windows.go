package main

// Implementación real de Operaciones: lo que el panel ordena sobre NEXO en
// Windows (lanzador, tarea programada, scripts de Node y PowerShell).

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	"fyne.io/systray"
	qrcode "github.com/skip2/go-qrcode"
	"golang.org/x/sys/windows"
)

const versionPanel = "1.0"

var (
	reNombreTarea = regexp.MustCompile(`^[A-Za-z0-9_-]{1,40}$`)
	reCodigoPar   = regexp.MustCompile(`[A-Z0-9]{4}-[A-Z0-9]{4}`)
	reTokenLog    = regexp.MustCompile(`(?i)(token=)[^\s&"'<>)\]]+`)
)

// nombreTarea es «NEXO»; NEXO_TASK_NAME existe sólo para probar con una tarea de prueba.
func nombreTarea() string {
	if v := os.Getenv("NEXO_TASK_NAME"); reNombreTarea.MatchString(v) {
		return v
	}
	return "NEXO"
}

type operaciones struct {
	a       *app
	elevado bool

	mu      sync.Mutex
	ocupado string

	autoMu       sync.Mutex
	auto         Autoarranque
	autoLeida    time.Time
	autoRefresca bool
}

func nuevasOperaciones(a *app) *operaciones {
	o := &operaciones{a: a, elevado: esElevado()}
	o.auto = o.consultarAutoarranque()
	o.autoLeida = time.Now()
	return o
}

// ---- Estado ---------------------------------------------------------------

func (o *operaciones) Estado() EstadoPanel {
	est, _ := leerEstado(o.a.rutaEstado())
	salud := comprobarSalud(puertoSalud(est, os.Getenv))
	visual := calcularVisual(salud, est)
	guardados := leerAjustes(rutaAjustes(o.a.rutas.StateDir))

	nombre := map[Visual]string{VisualActivo: "activo", VisualConectando: "conectando", VisualDetenido: "detenido"}[visual]
	modo := guardados.Modo
	if salud && est != nil && modoValido(est.Mode) {
		modo = est.Mode
	}
	pendientes := false
	if salud && est != nil && est.Ajustes != nil {
		pendientes = *est.Ajustes != guardados
	}
	o.mu.Lock()
	ocupado := o.ocupado
	o.mu.Unlock()
	return EstadoPanel{
		Estado:            nombre,
		TextoEstado:       visual.Texto(),
		Modo:              modo,
		Enlaces:           Enlaces{Internet: enlaceInternet(est), Local: enlaceLocal(est)},
		Autoarranque:      o.autoarranque(),
		Elevado:           o.elevado,
		Ajustes:           guardados,
		AjustesPendientes: pendientes,
		Ocupado:           ocupado,
		Version:           versionPanel,
	}
}

// ---- Control --------------------------------------------------------------

// ocupar marca una acción larga en curso; devuelve false si ya hay otra.
func (o *operaciones) ocupar(texto string) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.ocupado != "" {
		return false
	}
	o.ocupado = texto
	return true
}

func (o *operaciones) liberar() {
	o.mu.Lock()
	o.ocupado = ""
	o.mu.Unlock()
}

func (o *operaciones) esperarSalud(limite time.Duration) {
	fin := time.Now().Add(limite)
	for time.Now().Before(fin) {
		est, _ := leerEstado(o.a.rutaEstado())
		if comprobarSalud(puertoSalud(est, os.Getenv)) {
			return
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func (o *operaciones) Iniciar() {
	if !o.ocupar("Iniciando NEXO…") {
		return
	}
	go func() {
		defer o.liberar()
		o.a.log.Printf("panel: iniciar")
		// Si nexo-control stop dejó la marca de parada, el supervisor espera a que se borre.
		quitarMarcadorDetenido(o.a.rutas)
		o.a.lanzador.Iniciar()
		o.a.vigilante.Iniciar()
		o.esperarSalud(30 * time.Second)
	}()
}

func (o *operaciones) Detener() {
	if !o.ocupar("Deteniendo NEXO…") {
		return
	}
	go func() {
		defer o.liberar()
		o.a.log.Printf("panel: detener")
		o.a.vigilante.Detener()
		o.a.lanzador.Detener()
	}()
}

func (o *operaciones) Reiniciar() {
	if !o.ocupar("Reiniciando NEXO…") {
		return
	}
	go func() {
		defer o.liberar()
		o.reiniciarSincrono()
	}()
}

func (o *operaciones) reiniciarSincrono() {
	o.a.log.Printf("panel: reiniciar")
	o.a.vigilante.Detener()
	o.a.lanzador.Reiniciar()
	o.a.vigilante.Iniciar()
	o.esperarSalud(30 * time.Second)
}

// ---- Autoarranque ---------------------------------------------------------

func (o *operaciones) consultarAutoarranque() Autoarranque {
	script := fmt.Sprintf(`$ErrorActionPreference='Stop'
$t = Get-ScheduledTask -TaskName '%s' -ErrorAction SilentlyContinue
if (-not $t) { '{"instalado":false,"activo":false}'; exit 0 }
$activo = [bool]($t.Triggers | Where-Object { $_.Enabled } | Select-Object -First 1)
'{"instalado":true,"activo":' + $activo.ToString().ToLower() + '}'`, nombreTarea())
	salida, err := ejecutarPowerShell(15*time.Second, script)
	var r Autoarranque
	if err != nil || json.Unmarshal([]byte(strings.TrimSpace(salida)), &r) != nil {
		return Autoarranque{}
	}
	return r
}

// autoarranque devuelve el último valor conocido y lo refresca en segundo plano
// cada 10 s: consultar la tarea cuesta ~0,5 s y el panel pregunta cada 2 s.
func (o *operaciones) autoarranque() Autoarranque {
	o.autoMu.Lock()
	defer o.autoMu.Unlock()
	if time.Since(o.autoLeida) > 10*time.Second && !o.autoRefresca {
		o.autoRefresca = true
		go func() {
			nuevo := o.consultarAutoarranque()
			o.autoMu.Lock()
			o.auto, o.autoLeida, o.autoRefresca = nuevo, time.Now(), false
			o.autoMu.Unlock()
		}()
	}
	return o.auto
}

func (o *operaciones) SetAutoarranque(activo bool) (Autoarranque, error) {
	actual := o.consultarAutoarranque()
	if !actual.Instalado {
		return actual, errors.New("El autoarranque no está instalado. Ejecuta scripts\\windows\\install-autostart.ps1 (pide permisos de administrador).")
	}
	valor := "$false"
	if activo {
		valor = "$true"
	}
	script := fmt.Sprintf(`$ErrorActionPreference='Stop'
$t = Get-ScheduledTask -TaskName '%s'
if (-not $t.Triggers) { throw 'La tarea no tiene disparador de inicio de sesión.' }
foreach ($d in $t.Triggers) { $d.Enabled = %s }
Set-ScheduledTask -TaskName '%s' -Trigger $t.Triggers | Out-Null`, nombreTarea(), valor, nombreTarea())
	if _, err := ejecutarPowerShell(30*time.Second, script); err != nil {
		if !o.elevado {
			// Una tarea creada con privilegios máximos sólo la puede modificar un proceso elevado.
			return actual, errors.New("Windows no dejó cambiar el autoarranque: NEXO debe estar abierto con permisos de administrador. Ciérralo desde «Salir de NEXO» y ábrelo con el acceso directo «NEXO» del menú Inicio (o reinicia sesión).")
		}
		return actual, fmt.Errorf("No se pudo cambiar el autoarranque: %v", err)
	}
	nuevo := o.consultarAutoarranque()
	o.autoMu.Lock()
	o.auto, o.autoLeida = nuevo, time.Now()
	o.autoMu.Unlock()
	o.a.log.Printf("panel: autoarranque %v", nuevo.Activo)
	return nuevo, nil
}

// ---- Ajustes --------------------------------------------------------------

func (o *operaciones) GuardarAjustes(a Ajustes) (Ajustes, error) {
	valido, err := validarAjustes(a)
	if err != nil {
		return a, err
	}
	if err := guardarAjustes(rutaAjustes(o.a.rutas.StateDir), valido); err != nil {
		return a, fmt.Errorf("No se pudieron guardar los ajustes: %v", err)
	}
	o.a.log.Printf("panel: ajustes guardados (modo %s, gpu %v)", valido.Modo, valido.GPU)
	return valido, nil
}

// ---- Emparejar, rotar, contraseña -----------------------------------------

func (o *operaciones) nodeCmd(ctx context.Context, args ...string) (*exec.Cmd, error) {
	node, err := rutaNode()
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, node, args...)
	cmd.Dir = o.a.rutas.RepoRoot
	cmd.Env = append(os.Environ(), "NEXO_STATE_DIR="+o.a.rutas.StateDir)
	ocultar(cmd)
	return cmd, nil
}

func (o *operaciones) Emparejar(minutos int) (string, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd, err := o.nodeCmd(ctx, filepath.Join("scripts", "pair.js"), fmt.Sprint(minutos))
	if err != nil {
		return "", "", err
	}
	var salida, errores bytes.Buffer
	cmd.Stdout, cmd.Stderr = &salida, &errores
	if err := cmd.Run(); err != nil {
		o.a.log.Printf("panel: pair.js falló: %v", err)
		msg := limpiarSalida(errores.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", "", fmt.Errorf("No se pudo generar el código: %s", msg)
	}
	texto := limpiarSalida(salida.String())
	o.a.log.Printf("panel: código de emparejamiento generado")
	return reCodigoPar.FindString(texto), texto, nil
}

func (o *operaciones) Rotar() (string, error) {
	if !o.ocupar("Rotando el enlace…") {
		return "", errors.New("NEXO está ocupado con otra acción; espera a que termine.")
	}
	defer o.liberar()
	estado := o.a.rutaEstado()
	if _, err := os.Stat(estado); err != nil {
		return "", errors.New("NEXO todavía no ha arrancado nunca: no hay enlace que rotar.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd, err := o.nodeCmd(ctx, "rotate-token.js", estado, filepath.Join(o.a.rutas.StateDir, ".nexo-devices.json"))
	if err != nil {
		return "", err
	}
	var errores bytes.Buffer
	cmd.Stderr = &errores
	if err := cmd.Run(); err != nil {
		msg := limpiarSalida(errores.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("No se pudo rotar el enlace: %s", msg)
	}
	o.a.log.Printf("panel: token rotado")
	est, _ := leerEstado(estado)
	if comprobarSalud(puertoSalud(est, os.Getenv)) {
		o.reiniciarSincrono()
	}
	return "Enlace cambiado. Los enlaces que compartiste antes ya no sirven; los dispositivos emparejados siguen entrando. Copia el nuevo enlace.", nil
}

func (o *operaciones) CambiarContrasena(usuario, contrasena string) (string, error) {
	usuario = strings.TrimSpace(usuario)
	if usuario == "" || len([]rune(usuario)) > 64 || strings.ContainsAny(usuario, "\r\n\t\x00") {
		return "", errors.New("Escribe un usuario válido (hasta 64 caracteres).")
	}
	if n := len([]rune(contrasena)); n < 8 || n > 200 {
		return "", errors.New("La contraseña debe tener entre 8 y 200 caracteres.")
	}
	if strings.ContainsAny(contrasena, "\r\n\x00") {
		return "", errors.New("La contraseña no puede llevar saltos de línea.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd, err := o.nodeCmd(ctx, "auth-manager.js", "set", usuario)
	if err != nil {
		return "", err
	}
	// Por stdin: nunca en la línea de órdenes.
	cmd.Stdin = strings.NewReader(contrasena)
	var errores bytes.Buffer
	cmd.Stderr = &errores
	if err := cmd.Run(); err != nil {
		o.a.log.Printf("panel: auth-manager falló: %v", err)
		return "", errors.New("No se pudo cambiar la contraseña.")
	}
	o.a.log.Printf("panel: contraseña de Mi PC cambiada")
	est, _ := leerEstado(o.a.rutaEstado())
	if comprobarSalud(puertoSalud(est, os.Getenv)) && o.ocupar("Reiniciando NEXO…") {
		defer o.liberar()
		o.reiniciarSincrono()
		return "Contraseña cambiada. NEXO se reinició para aplicarla.", nil
	}
	return "Contraseña cambiada. Se usará la próxima vez que NEXO arranque.", nil
}

// ---- Aviso del enlace -----------------------------------------------------

func (o *operaciones) LeerAviso() AvisoPanel {
	a := leerAviso(rutaAviso())
	return AvisoPanel{Metodo: a.Metodo, NtfyServidor: a.NtfyServidor, NtfyTema: a.NtfyTema, TelegramChat: a.TelegramChat, TieneTelegramToken: a.TelegramToken != ""}
}

func (o *operaciones) GuardarAviso(a Aviso, conservarToken bool) error {
	if err := validarAviso(a, conservarToken); err != nil {
		return err
	}
	dir := filepath.Dir(rutaAviso())
	if _, err := os.Stat(dir); err != nil {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("No se pudo crear la carpeta de configuración: %v", err)
		}
	}
	// El archivo puede guardar el token de un bot: la carpeta se deja privada.
	protegerCarpeta(dir)
	if err := guardarAviso(rutaAviso(), a, conservarToken); err != nil {
		return fmt.Errorf("No se pudo guardar la configuración del aviso: %v", err)
	}
	o.a.log.Printf("panel: aviso configurado (%s)", a.Metodo)
	o.a.vigilante.Detener()
	o.a.vigilante.Iniciar() // no arranca si el método es «ninguno»
	return nil
}

func (o *operaciones) scriptPS(nombre string) (string, error) {
	ruta := filepath.Join(o.a.rutas.RepoRoot, "scripts", "windows", nombre)
	if _, err := os.Stat(ruta); err != nil {
		return "", fmt.Errorf("Falta %s", ruta)
	}
	return ruta, nil
}

func ejecutablePowerShell() string {
	if p, err := exec.LookPath("pwsh"); err == nil {
		return p
	}
	return "powershell.exe"
}

func (o *operaciones) correrScript(nombre string, limite time.Duration, args ...string) (string, int, error) {
	ruta, err := o.scriptPS(nombre)
	if err != nil {
		return "", 0, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), limite)
	defer cancel()
	cmd := exec.CommandContext(ctx, ejecutablePowerShell(), append([]string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ruta}, args...)...)
	cmd.Dir = o.a.rutas.RepoRoot
	cmd.Env = append(os.Environ(), "NEXO_STATE_DIR="+o.a.rutas.StateDir, "NEXO_LOGS_DIR="+o.a.rutas.LogsDir)
	var salida bytes.Buffer
	cmd.Stdout, cmd.Stderr = &salida, &salida
	ocultar(cmd)
	err = cmd.Run()
	codigo := 0
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		codigo, err = ee.ExitCode(), nil
	}
	if ctx.Err() != nil {
		return limpiarSalida(salida.String()), codigo, errors.New("La operación tardó demasiado y se canceló.")
	}
	return limpiarSalida(decodificarSalida(salida.Bytes())), codigo, err
}

// decodificarSalida: PowerShell escribe en UTF-8 gracias a [Console]::OutputEncoding
// en nuestros scripts; si viniera con BOM se quita.
func decodificarSalida(b []byte) string {
	return strings.TrimPrefix(string(b), "\xef\xbb\xbf")
}

func (o *operaciones) ProbarAviso() (string, error) {
	texto, codigo, err := o.correrScript("nexo-avisar-enlace.ps1", 45*time.Second, "prueba")
	if err != nil {
		return "", err
	}
	if codigo != 0 {
		return "", fmt.Errorf("No se pudo enviar el aviso de prueba. %s", texto)
	}
	return texto, nil
}

func (o *operaciones) Doctor() (string, error) {
	texto, _, err := o.correrScript("nexo-doctor.ps1", 90*time.Second)
	if err != nil {
		return "", err
	}
	return texto, nil // un código 1 sólo significa «hay FALLAS»: el texto lo cuenta
}

// ---- Registro y carpeta ---------------------------------------------------

func (o *operaciones) Registro() string {
	ruta := filepath.Join(o.a.rutas.LogsDir, "nexo-runtime.log")
	f, err := os.Open(ruta)
	if err != nil {
		return "Todavía no hay registro de NEXO."
	}
	defer f.Close()
	const cola = 96 * 1024
	if info, err := f.Stat(); err == nil && info.Size() > cola {
		_, _ = f.Seek(info.Size()-cola, 0)
	}
	var b bytes.Buffer
	_, _ = b.ReadFrom(f)
	lineas := strings.Split(strings.ReplaceAll(b.String(), "\r\n", "\n"), "\n")
	if len(lineas) > 120 {
		lineas = lineas[len(lineas)-120:]
	}
	return reTokenLog.ReplaceAllString(strings.Join(lineas, "\n"), "${1}***")
}

func (o *operaciones) AbrirRegistros() error {
	cmd := exec.Command("explorer.exe", o.a.rutas.LogsDir)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait()
	return nil
}

// ---- QR y salida ----------------------------------------------------------

func (o *operaciones) QR(que string) ([]byte, error) {
	est, _ := leerEstado(o.a.rutaEstado())
	enlace := enlaceLocal(est)
	if que == "internet" {
		enlace = enlaceInternet(est)
	}
	if enlace == "" {
		return nil, nil
	}
	return qrcode.Encode(enlace, qrcode.Medium, 320)
}

func (o *operaciones) Salir(detener bool) {
	o.a.log.Printf("panel: salir (detener=%v)", detener)
	if detener {
		o.a.vigilante.Detener()
		o.a.lanzador.Detener()
	}
	systray.Quit()
}

// ---- Utilidades -----------------------------------------------------------

// ejecutarPowerShell corre un script corto con Windows PowerShell (siempre
// presente) y devuelve su salida. El script va codificado: sin problemas de comillas.
func ejecutarPowerShell(limite time.Duration, script string) (string, error) {
	unidades := utf16.Encode([]rune(script))
	bytesUTF16 := make([]byte, 0, len(unidades)*2)
	for _, u := range unidades {
		bytesUTF16 = append(bytesUTF16, byte(u), byte(u>>8))
	}
	ctx, cancel := context.WithTimeout(context.Background(), limite)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", base64.StdEncoding.EncodeToString(bytesUTF16))
	var salida, errores bytes.Buffer
	cmd.Stdout, cmd.Stderr = &salida, &errores
	ocultar(cmd)
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errores.String())
		if msg == "" {
			msg = err.Error()
		}
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return salida.String(), errors.New(msg)
	}
	return salida.String(), nil
}

// protegerCarpeta deja una carpeta legible sólo por el usuario, SYSTEM y
// Administradores (la misma ACL que instala install-autostart.ps1). Es de
// mejor esfuerzo: si icacls falla, sigue.
func protegerCarpeta(dir string) {
	usuario, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return
	}
	cmd := exec.Command("icacls", dir, "/inheritance:r", "/grant:r", "*"+usuario.User.Sid.String()+":(OI)(CI)F", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F")
	ocultar(cmd)
	_ = cmd.Run()
}
