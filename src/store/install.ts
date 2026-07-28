/**
 * Instalación y almacenamiento persistente — §12.3.
 *
 * **Safari borra el almacenamiento de los sitios no visitados en 7 días. Las PWA
 * instaladas en la pantalla de inicio están exentas.** Si no se instala, se llega
 * al destino con la caché vacía: la app arranca, no encuentra nada y estás en
 * Tailandia sin guía. Por eso el aviso es permanente hasta que se instala, y no
 * se puede descartar.
 */

export interface StorageStatus {
  installed: boolean;
  /** `navigator.storage.persist()` concedido. Sin esto, el desalojo es posible. */
  persisted: boolean;
  usage: number | null;
  quota: number | null;
}

/**
 * `display-mode: standalone` cubre el caso general; `navigator.standalone` es la
 * propiedad no estándar de Safari en iOS, que es justo el caso que importa.
 */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

export async function storageStatus(): Promise<StorageStatus> {
  const installed = isInstalled();
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  const estimate = await navigator.storage?.estimate?.().catch(() => null);

  return {
    installed,
    persisted,
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
  };
}

export function formatBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} kB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Instrucciones de instalación. iOS no ofrece `beforeinstallprompt`: se explica a mano. */
export function installHint(): string {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  return iOS
    ? 'Pulsa Compartir y luego «Añadir a pantalla de inicio». Sin instalar, Safari borra los datos a los 7 días de no abrirla.'
    : 'Instala la app desde el menú del navegador para que el navegador no borre los datos.';
}
