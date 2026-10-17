//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"

	"github.com/go-ole/go-ole"
	"golang.org/x/sys/windows"
)

const (
	smXVirtualScreen  = 76
	smYVirtualScreen  = 77
	smCXVirtualScreen = 78
	smCYVirtualScreen = 79

	dxgiErrorNotFound = 0x887A0002
)

var (
	modDXGI                = syscall.NewLazyDLL("dxgi.dll")
	procCreateDXGIFactory1 = modDXGI.NewProc("CreateDXGIFactory1")
	procGetSystemMetrics   = modUser32.NewProc("GetSystemMetrics")
	procEnumDisplayDevices = modUser32.NewProc("EnumDisplayDevicesW")

	iidIDXGIFactory1 = ole.NewGUID("{770aae78-f26f-4dba-a829-253c83d1b387}")
)

type monitorInfo struct {
	Index       int    `json:"index"`
	Name        string `json:"name"`
	Description string `json:"description"`
	X           int    `json:"x"`
	Y           int    `json:"y"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Primary     bool   `json:"primary"`
	Rotation    int    `json:"rotation"`
}

type virtualBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type winRect struct {
	Left   int32
	Top    int32
	Right  int32
	Bottom int32
}

type dxgiOutputDesc struct {
	DeviceName         [32]uint16
	DesktopCoordinates winRect
	AttachedToDesktop  int32
	Rotation           uint32
	Monitor            uintptr
}

type displayDeviceW struct {
	Cb           uint32
	DeviceName   [32]uint16
	DeviceString [128]uint16
	StateFlags   uint32
	DeviceID     [128]uint16
	DeviceKey    [128]uint16
}

type comObject struct {
	vtbl *[16]uintptr
}

func (c *comObject) release() {
	if c == nil || c.vtbl == nil {
		return
	}
	syscall.SyscallN(c.vtbl[2], uintptr(unsafe.Pointer(c)))
}

func getSystemMetric(index int) int {
	r1, _, _ := procGetSystemMetrics.Call(uintptr(index))
	return int(int32(r1))
}

func getVirtualScreenBounds() virtualBounds {
	vw := getSystemMetric(smCXVirtualScreen)
	vh := getSystemMetric(smCYVirtualScreen)
	if vw <= 0 {
		vw = 1920
	}
	if vh <= 0 {
		vh = 1080
	}
	return virtualBounds{
		X:      getSystemMetric(smXVirtualScreen),
		Y:      getSystemMetric(smYVirtualScreen),
		Width:  vw,
		Height: vh,
	}
}

func dxgiRotationToDegrees(rot uint32) int {
	switch rot {
	case 2:
		return 90
	case 3:
		return 180
	case 4:
		return 270
	default:
		return 0
	}
}

func monitorFriendlyDescription(deviceName string) string {
	namePtr, err := syscall.UTF16PtrFromString(deviceName)
	if err != nil {
		return deviceName
	}
	var dd displayDeviceW
	dd.Cb = uint32(unsafe.Sizeof(dd))
	r1, _, _ := procEnumDisplayDevices.Call(
		uintptr(unsafe.Pointer(namePtr)),
		0,
		uintptr(unsafe.Pointer(&dd)),
		0,
	)
	if r1 != 0 {
		if desc := windows.UTF16ToString(dd.DeviceString[:]); desc != "" {
			return desc
		}
	}
	return deviceName
}

func queryMonitors() ([]monitorInfo, virtualBounds, error) {
	virt := getVirtualScreenBounds()
	var factory *comObject
	hr, _, _ := procCreateDXGIFactory1.Call(
		uintptr(unsafe.Pointer(iidIDXGIFactory1)),
		uintptr(unsafe.Pointer(&factory)),
	)
	if hr != 0 || factory == nil {
		return nil, virt, fmt.Errorf("CreateDXGIFactory1 falló con código 0x%08x", uint32(hr))
	}
	defer factory.release()

	// IDXGIFactory1::EnumAdapters1 es el índice 12 de la vtable.
	var adapter *comObject
	hr, _, _ = syscall.SyscallN(
		factory.vtbl[12],
		uintptr(unsafe.Pointer(factory)),
		0,
		uintptr(unsafe.Pointer(&adapter)),
	)
	if hr != 0 || adapter == nil {
		return nil, virt, fmt.Errorf("EnumAdapters1(0) falló con código 0x%08x", uint32(hr))
	}
	defer adapter.release()

	// IDXGIAdapter1::EnumOutputs es el índice 7 de la vtable.
	var monitors []monitorInfo
	for i := 0; ; i++ {
		var output *comObject
		hr, _, _ := syscall.SyscallN(
			adapter.vtbl[7],
			uintptr(unsafe.Pointer(adapter)),
			uintptr(i),
			uintptr(unsafe.Pointer(&output)),
		)
		if uint32(hr) == dxgiErrorNotFound || output == nil {
			break
		}
		if hr != 0 {
			break
		}
		// IDXGIOutput::GetDesc es el índice 7 de la vtable.
		var desc dxgiOutputDesc
		hrDesc, _, _ := syscall.SyscallN(
			output.vtbl[7],
			uintptr(unsafe.Pointer(output)),
			uintptr(unsafe.Pointer(&desc)),
		)
		output.release()
		if hrDesc != 0 || desc.AttachedToDesktop == 0 {
			continue
		}
		name := windows.UTF16ToString(desc.DeviceName[:])
		x := int(desc.DesktopCoordinates.Left)
		y := int(desc.DesktopCoordinates.Top)
		w := int(desc.DesktopCoordinates.Right - desc.DesktopCoordinates.Left)
		h := int(desc.DesktopCoordinates.Bottom - desc.DesktopCoordinates.Top)
		monitors = append(monitors, monitorInfo{
			Index:       i,
			Name:        name,
			Description: monitorFriendlyDescription(name),
			X:           x,
			Y:           y,
			Width:       w,
			Height:      h,
			Primary:     x == 0 && y == 0,
			Rotation:    dxgiRotationToDegrees(desc.Rotation),
		})
	}
	return monitors, virt, nil
}
