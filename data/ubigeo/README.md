# Ubigeo del Perú (INEI)

- **Fuente oficial:** INEI — "Ubigeos (Códigos de Ubicación Geográfica)", Plataforma Nacional de Datos Abiertos.
  https://www.datosabiertos.gob.pe/dataset/ubigeos-c%C3%B3digos-de-ubicaci%C3%B3n-geogr%C3%A1fica-instituto-nacional-de-estad%C3%ADstica-e-inform%C3%A1tica-inei
  Archivo: `UBIGEOS_2022_1891_distritos.zip` (modificado 2023-09-06). Licencia ODbL.
- `inei-2022-1891-distritos.csv`: el mismo archivo convertido a UTF-8, sin las notas al pie.
  25 departamentos · 196 provincias · 1,891 distritos.
- `provisional.csv`: distritos creados por ley **después** de ese archivo. Sus códigos son
  provisionales (siguiente correlativo en su provincia) hasta que el INEI publique los oficiales:
  - Santa Rosa de Loreto — Ley 32403 (2025), Mariscal Ramón Castilla, Loreto.
  - Sangani — Ley 32729 (El Peruano, 2026-07-15), Chanchamayo, Junín.

Para regenerar la migración: `npm run ubigeo:build`.
Revisar al menos una vez al año nuevas leyes de creación de distritos en El Peruano.
