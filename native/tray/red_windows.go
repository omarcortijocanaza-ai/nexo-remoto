package main

// Red y firewall desde el panel: marcar la red de casa como Privada, cerrar las reglas que Windows
// abrió para NEXO en redes Públicas y abrir el puerto del HTTPS de la LAN.
//
// Por qué existe: las reglas de NEXO (install-autostart.ps1) sólo valen en el perfil Privado, pero
// Windows suele clasificar una Ethernet doméstica como «Pública». Mientras sea así, el celular entra
// por la LAN gracias a las reglas «ajenas» que Windows creó solo al preguntar la primera vez. Quitarlas
// sin arreglar antes el perfil de la red cortaría el acceso por LAN: por eso las acciones van en orden
// y el panel avisa. Nada de esto se ejecuta solo: cada acción la pide una persona con un botón.

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	puertoHTTPSLan   = 8443
	nombreReglaHTTPS = "NEXO HTTPS 8443 (node)"
)

// scriptRed devuelve el script de PowerShell 5.1 para una acción: leer | privada | cerrar | https.
// Todas terminan imprimiendo el mismo JSON (el estado de la red tras la acción).
func scriptRed(accion, nodo, repo string) string {
	lit := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	var b strings.Builder
	fmt.Fprintf(&b, "$ErrorActionPreference = 'Stop'\n$accion = %s\n$nodo = %s\n$repo = %s\n$puertoHttps = %d\n$nombreHttps = %s\n",
		lit(accion), lit(nodo), lit(repo), puertoHTTPSLan, lit(nombreReglaHTTPS))
	b.WriteString(`$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
$cerradas = 0

function EsDeNexo([string] $programa) {
    if (-not $programa) { return $false }
    $p = $programa.ToLowerInvariant()
    if ($nodo -and $p -eq $nodo.ToLowerInvariant()) { return $true }
    if ($ffmpeg -and $p -eq $ffmpeg.ToLowerInvariant()) { return $true }
    return $p.StartsWith(($repo.TrimEnd('\') + '\bin\').ToLowerInvariant())
}
function PerfilIncluyePublico($regla) { $perfil = [string]$regla.Profile; return ($perfil -match 'Public|Any' -or $perfil -eq '0') }

if ($accion -eq 'privada') {
    # Sólo las redes conectadas que hoy son Públicas; las demás no se tocan.
    Get-NetConnectionProfile | Where-Object { [string]$_.NetworkCategory -eq 'Public' } | Set-NetConnectionProfile -NetworkCategory Private
}
if ($accion -eq 'https') {
    if (-not (Get-NetFirewallRule -DisplayName $nombreHttps -ErrorAction SilentlyContinue)) {
        $parametros = @{ DisplayName = $nombreHttps; Direction = 'Inbound'; Action = 'Allow'; Protocol = 'TCP'; LocalPort = $puertoHttps; Profile = 'Private' }
        if ($nodo) { $parametros.Program = $nodo }
        New-NetFirewallRule @parametros | Out-Null
    }
}

$perfiles = @(Get-NetConnectionProfile | ForEach-Object { [pscustomobject]@{ nombre = $_.Name; interfaz = $_.InterfaceAlias; categoria = [string]$_.NetworkCategory } })

# Se filtran primero las aplicaciones de una vez: preguntar regla por regla tarda decenas de segundos.
$filtros = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -match 'nexo|\\node\.exe|\\ffmpeg\.exe' })
$publicas = @()
$nexo = 0
foreach ($f in $filtros) {
    $r = $f | Get-NetFirewallRule -ErrorAction SilentlyContinue
    if (-not $r) { continue }
    if ($r.DisplayName -clike 'NEXO *') { if ($r.DisplayName -ne $nombreHttps) { $nexo++ }; continue }
    if ("$($r.Direction)" -ne 'Inbound' -or "$($r.Action)" -ne 'Allow' -or "$($r.Enabled)" -ne 'True') { continue }
    if (-not (PerfilIncluyePublico $r)) { continue }
    if (-not (EsDeNexo $f.Program)) { continue }
    $puerto = ($r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue)
    if ($accion -eq 'cerrar') {
        # Una regla sólo Pública se borra; una que también vale en Privado/Dominio pierde únicamente el Público.
        $perfil = [string]$r.Profile
        $resto = @(@('Domain', 'Private') | Where-Object { $perfil -match $_ -or $perfil -match 'Any' })
        if ($resto.Count -eq 0) { Remove-NetFirewallRule -Name $r.Name } else { Set-NetFirewallRule -Name $r.Name -Profile ($resto -join ',') }
        $cerradas++
    } else {
        $publicas += [pscustomobject]@{ nombre = $r.DisplayName; programa = $f.Program; protocolo = [string]$puerto.Protocol }
    }
}
$https = [bool](Get-NetFirewallRule -DisplayName $nombreHttps -ErrorAction SilentlyContinue)
$privadaOConectada = @($perfiles | Where-Object { $_.categoria -ne 'Public' }).Count -gt 0
$salida = [ordered]@{
    perfiles = $perfiles
    todasPublicas = (@($perfiles).Count -gt 0 -and -not $privadaOConectada)
    reglasPublicas = $publicas
    reglasNexo = $nexo
    reglaHttps = $https
    cerradas = $cerradas
}
ConvertTo-Json -InputObject $salida -Compress -Depth 5
`)
	return b.String()
}

// salidaRed es lo que imprime scriptRed.
type salidaRed struct {
	Perfiles       []PerfilRed    `json:"perfiles"`
	TodasPublicas  bool           `json:"todasPublicas"`
	ReglasPublicas []ReglaPublica `json:"reglasPublicas"`
	ReglasNexo     int            `json:"reglasNexo"`
	ReglaHTTPS     bool           `json:"reglaHttps"`
	Cerradas       int            `json:"cerradas"`
}

// analizarSalidaRed convierte el JSON del script en RedPanel. PowerShell 5.1 escribe un elemento
// suelto como objeto y no como lista; aquí se aceptan las dos formas.
func analizarSalidaRed(texto string, elevado bool) (RedPanel, int, error) {
	texto = strings.TrimSpace(strings.TrimPrefix(texto, "\xef\xbb\xbf"))
	inicio := strings.Index(texto, "{")
	if inicio < 0 {
		return RedPanel{}, 0, errors.New("PowerShell no devolvió datos de red.")
	}
	var crudo struct {
		Perfiles       json.RawMessage `json:"perfiles"`
		TodasPublicas  bool            `json:"todasPublicas"`
		ReglasPublicas json.RawMessage `json:"reglasPublicas"`
		ReglasNexo     int             `json:"reglasNexo"`
		ReglaHTTPS     bool            `json:"reglaHttps"`
		Cerradas       int             `json:"cerradas"`
	}
	if err := json.Unmarshal([]byte(texto[inicio:]), &crudo); err != nil {
		return RedPanel{}, 0, fmt.Errorf("No se entendió la respuesta de PowerShell: %v", err)
	}
	red := RedPanel{
		Comprobado: true, TodasPublicas: crudo.TodasPublicas, ReglasNexo: crudo.ReglasNexo,
		ReglaHTTPS: crudo.ReglaHTTPS, PuertoHTTPS: puertoHTTPSLan, Elevado: elevado,
		Perfiles: []PerfilRed{}, ReglasPublicas: []ReglaPublica{},
	}
	if err := listaOUno(crudo.Perfiles, &red.Perfiles); err != nil {
		return RedPanel{}, 0, err
	}
	if err := listaOUno(crudo.ReglasPublicas, &red.ReglasPublicas); err != nil {
		return RedPanel{}, 0, err
	}
	return red, crudo.Cerradas, nil
}

// listaOUno decodifica "[...]", "{...}" o null en un slice.
func listaOUno[T any](crudo json.RawMessage, destino *[]T) error {
	t := strings.TrimSpace(string(crudo))
	if t == "" || t == "null" {
		return nil
	}
	if strings.HasPrefix(t, "[") {
		return json.Unmarshal(crudo, destino)
	}
	var uno T
	if err := json.Unmarshal(crudo, &uno); err != nil {
		return err
	}
	*destino = []T{uno}
	return nil
}

func (o *operaciones) correrRed(accion string) (RedPanel, int, error) {
	nodo, _ := rutaNode() // vacío si no se encuentra: simplemente no habrá regla de node
	script := scriptRed(accion, nodo, o.a.rutas.RepoRoot)
	salida, err := ejecutarPowerShell(90*time.Second, script)
	if err != nil {
		return RedPanel{}, 0, fmt.Errorf("No se pudo consultar o cambiar la red: %v", err)
	}
	return analizarSalidaRed(salida, o.elevado)
}

var errSinAdmin = errors.New("Windows sólo deja cambiar el firewall y la red a un programa con permisos de administrador: cierra NEXO («Salir de NEXO») y ábrelo con el acceso directo «NEXO» del menú Inicio.")

func (o *operaciones) Red() (RedPanel, error) {
	red, _, err := o.correrRed("leer")
	if err != nil {
		return RedPanel{Comprobado: false, Error: err.Error(), Perfiles: []PerfilRed{}, ReglasPublicas: []ReglaPublica{}, Elevado: o.elevado, PuertoHTTPS: puertoHTTPSLan}, nil
	}
	return red, nil
}

func (o *operaciones) MarcarRedPrivada() (RedPanel, error) {
	if !o.elevado {
		return RedPanel{}, errSinAdmin
	}
	red, _, err := o.correrRed("privada")
	if err != nil {
		return RedPanel{}, err
	}
	o.a.log.Printf("panel: red marcada como privada")
	return red, nil
}

func (o *operaciones) CerrarReglasPublicas(forzar bool) (RedPanel, string, error) {
	if !o.elevado {
		return RedPanel{}, "", errSinAdmin
	}
	actual, _, err := o.correrRed("leer")
	if err != nil {
		return RedPanel{}, "", err
	}
	if len(actual.ReglasPublicas) == 0 {
		return actual, "No hay reglas públicas de NEXO que cerrar.", nil
	}
	// Candado: con todas las redes en Pública, las reglas «ajenas» son hoy lo único que deja entrar al celular.
	if actual.TodasPublicas && !forzar {
		return actual, "", errors.New("Tu red actual está marcada como Pública: si cierras estas reglas, el celular dejará de entrar por el Wi-Fi de casa. Primero marca tu red como Privada.")
	}
	red, cerradas, err := o.correrRed("cerrar")
	if err != nil {
		return RedPanel{}, "", err
	}
	o.a.log.Printf("panel: reglas públicas del firewall cerradas (%d)", cerradas)
	return red, fmt.Sprintf("Listo: se cerraron %d regla(s) para redes públicas.", cerradas), nil
}

func (o *operaciones) AbrirPuertoHTTPS() (RedPanel, error) {
	if !o.elevado {
		return RedPanel{}, errSinAdmin
	}
	red, _, err := o.correrRed("https")
	if err != nil {
		return RedPanel{}, err
	}
	o.a.log.Printf("panel: regla de firewall del HTTPS de la LAN lista (puerto %d)", puertoHTTPSLan)
	return red, nil
}

// asegurarReglaHTTPS lo llama GuardarAjustes al activar el HTTPS: mejor esfuerzo, sin romper el guardado.
func (o *operaciones) asegurarReglaHTTPS() {
	if !o.elevado {
		o.a.log.Printf("panel: HTTPS de la LAN activado, pero sin permisos de administrador no se pudo abrir el puerto %d", puertoHTTPSLan)
		return
	}
	if _, err := o.AbrirPuertoHTTPS(); err != nil {
		o.a.log.Printf("panel: no se pudo abrir el puerto HTTPS: %v", err)
	}
}
