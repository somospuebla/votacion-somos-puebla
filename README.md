# Votación · Consejo Estatal Somos Puebla

Sitio estático (GitHub Pages) + Firebase (Firestore y Authentication).

- `index.html` → consejeros: entran con código individual o QR y votan.
- `admin.html` → administrador: crea votaciones (secretas o nominales), genera códigos/tarjetas con QR, ve participación y cierra votaciones.

## Puesta en marcha

1. **Firebase**: crea un proyecto en <https://console.firebase.google.com>.
2. **Authentication → Sign-in method**: activa **Anónimo** y **Correo/contraseña**.
3. **Authentication → Users**: crea tu usuario administrador (correo + contraseña propios). Copia su **UID**.
4. **Firestore Database**: créala (modo producción).
5. **Reglas**: pega el contenido de `firestore.rules` en Firestore → Reglas → Publicar.
6. **Admin**: en Firestore crea la colección `admins` con un documento cuyo **ID sea tu UID** (puede tener un campo cualquiera, p. ej. `rol: "admin"`). Si no lo conoces, intenta entrar en `admin.html`: el mensaje de error te muestra el UID.
7. **Configuración web**: Configuración del proyecto → Tus apps → Web; copia el objeto `firebaseConfig` a `js/firebase-config.js`.
8. **Dominios**: Authentication → Settings → Authorized domains → agrega `TU_USUARIO.github.io`.
9. **GitHub**: sube la carpeta a un repositorio, Settings → Pages → Deploy from branch (`main`, `/root`).

## Uso

1. `admin.html` → pestaña *Consejeros*: pega los nombres, genera códigos e imprime las tarjetas (cada una trae QR que abre el sitio ya con el código).
2. Pestaña *Votaciones*: crea la votación (borrador) → **Abrir** → los consejeros votan → **Cerrar y publicar resultados**.
3. Durante la votación solo tú ves el conteo en vivo y quién falta por votar. Al cerrar, los resultados se publican a los consejeros.

## Seguridad y límites (léelo)

- Un voto por código y por votación, garantizado por las reglas de Firestore (no solo por la interfaz). Las boletas no se pueden modificar ni borrar.
- **Voto secreto**: la boleta no guarda identidad; el registro de "quién votó" va en otro documento. Sin embargo, con solo reglas de Firestore (sin servidor) un administrador con acceso a la base de datos podría intentar correlacionar por marcas de tiempo. Es secreto frente a consejeros y en pantalla, no frente a quien administra Firebase. Si se requiere secreto fuerte, hay que añadir Cloud Functions (plan Blaze).
- Los códigos tienen ~40 bits de aleatoriedad; trátalos como credenciales. Se guardan en claro en `members` (solo lectura para el administrador) para poder reimprimir tarjetas. Quitar a un consejero invalida su código.
- Las reglas **no se han probado contra un proyecto real**: antes de una votación oficial haz un simulacro con códigos de prueba y verifica que (a) no se pueda votar dos veces y (b) un consejero no pueda leer boletas.
- Este sistema es una herramienta interna de apoyo; conserva el acta oficial de la sesión.
