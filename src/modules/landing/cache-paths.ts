/** ¿El contenido de una landing (JSON) usa esta ruta de imagen? Sirve para no borrar fotos que siguen en uso. */
export function contentUsesPath(content: unknown, path: string): boolean {
  if (content === null || content === undefined || !path) return false;
  // Se compara contra el JSON serializado: la ruta aparece entre comillas en cualquier bloque
  return JSON.stringify(content).includes(JSON.stringify(path));
}
