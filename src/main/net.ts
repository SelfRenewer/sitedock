import os from 'node:os'

/** IPv4 машины в локальной сети. en0 (Wi-Fi/Ethernet на маке) в приоритете. */
export function lanAddress(): string | null {
  const ifaces = os.networkInterfaces()
  const names = Object.keys(ifaces).sort((a, b) => {
    const weight = (n: string) => (n === 'en0' ? 0 : n.startsWith('en') ? 1 : 2)
    return weight(a) - weight(b)
  })
  for (const name of names) {
    for (const addr of ifaces[name] ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return null
}

/**
 * Адрес в mesh-сети Tailscale. Такие сети раздают диапазон 100.64.0.0/10,
 * и адрес закреплён за машиной — в отличие от имени быстрого туннеля.
 */
export function meshAddress(): string | null {
  const ifaces = os.networkInterfaces()
  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4') continue
      const [a, b] = addr.address.split('.').map(Number)
      if (a === 100 && b >= 64 && b <= 127) return addr.address
    }
  }
  return null
}
