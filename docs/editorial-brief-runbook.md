# Runbook: flujo completo de brief editorial

Documenta el proceso paso a paso para cargar una investigación de nicho, extraer, aprobar y usar un brief editorial en la plataforma.

---

## 1. Subir la investigación como fuente de referencia

1. Abrir la página de fuentes del proyecto
2. Arrastrar el archivo Markdown con los hallazgos de Google Trends
3. Confirmar que el estado de procesamiento cambie a `processed`
4. Copiar el UUID de la fuente recién creada

**Resultado esperado:** el archivo aparece como fuente disponible en el selector de `evidenceSourceIds`.

---

## 2. Abrir la pestana "Brief editorial" del proyecto

1. Navegar a `/projects/[id]/editorial-brief`
2. Verificar que la interfaz muestre el formulario vacio o con datos de un draft existente

**Resultado esperado:** formulario con secciones: Mercado, Audiencia, Tesis, Voz, Estrategia de contenido, Vallas, Evidencia, Empaque, Base de investigacion.

---

## 3. Extraer borrador desde la investigacion cargada

1. Hacer clic en "Extraer desde fuente"
2. Seleccionar la fuente de investigacion subida en el paso 1
3. Esperar a que la IA genere el borrador inicial
4. Revisar que los valores extraidos no esten vacios ni contengan texto placeholder como `{tema}`

**Resultado esperado:** todas las secciones del brief se llenan con datos derivados de la investigacion.

---

## 4. Verificar y editar campos globales

Revisar cada seccion del brief:

| Seccion    | Que verificar                                                            |
| ---------- | ------------------------------------------------------------------------ |
| Mercado    | Region, idioma de investigacion, idioma del manuscrito                   |
| Audiencia  | Lector primario, situacion, dolor, nivel de conciencia, objeciones       |
| Tesis      | Problema central, resultado deseado, promesa, mecanismo, limite realista |
| Voz        | Tono, postura, nivel de lectura, que evitar                              |
| Estrategia | Pilares, escenarios requeridos, patron recurrente, politica de ejemplos  |
| Vallas     | Principios eticos, afirmaciones prohibidas, encuadre prohibido           |
| Evidencia  | Modo RAG, politica de citacion                                           |
| Empaque    | Angulo del titulo, hook, terminos SEO                                    |
| Base       | Hallazgos, inferencias, limitaciones                                     |

**Reglas:**

- Mantener la distincion de mercado: investigacion en ingles, manuscrito en espanol
- La promesa debe incluir un limite realista explicito
- Verificar que `forbiddenFraming` incluya manipulacion, trucos y tecnicas coercitivas
- La politica de ejemplos debe prohibir mensajes unicos como unica opcion

---

## 5. Verificar y editar contratos de capitulo

Para cada capitulo en la pestana "Contratos de capitulo":

1. **Job to be done:** una accion especifica que el capitulo debe lograr
2. **Reader shift:** el cambio mental del lector antes -> despues
3. **Must cover:** entre 3 y 6 puntos tematicos obligatorios
4. **Required scenarios:** situaciones concretas que el capitulo debe cubrir
5. **Evidence needs:** placeholders con consulta de busqueda y si son requeridos
6. **Tone adjustment:** ajuste de tono especifico para el capitulo
7. **Avoid overlap with:** capitulos cuyo contenido no debe repetirse
8. **Transition to next:** que sigue despues de este capitulo

**Regla:** Ningun `evidenceNeed` requerido debe quedar sin placeholder definido. Los placeholders no requeridos son opcionales.

---

## 6. Aprobar la version

1. Hacer clic en "Aprobar version"
2. Confirmar el cuadro de dialogo
3. Verificar que el estado del brief cambie a `approved`
4. Verificar que aparezca el numero de version (v1, v2, etc.)

**Resultado esperado:** el brief queda fijado. Cualquier generacion nueva usara esta version.

---

## 7. Refrescar placeholders de evidencia desactualizados

1. Abrir la pestana "Placeholders" del proyecto
2. Identificar placeholders con estado `stale`
3. Para cada placeholder stale:
   - Verificar la consulta de busqueda asociada
   - Ejecutar "Rellenar placeholder" (usa el modo RAG configurado)
4. Confirmar que el estado cambie a `filled`

**Resultado esperado:** todos los placeholders requeridos estan en estado `filled`.

---

## 8. Generar un capitulo representativo

1. Seleccionar un capitulo del indice (recomendado: el primero, "primer mensaje")
2. Hacer clic en "Generar capitulo"
3. Esperar a que el pipeline complete: pending -> generating -> assembling -> completed
4. Verificar que los fragmentos se hayan generado correctamente
5. Verificar que el ensamblaje incluya todos los `mustCover`

**Resultado esperado:** capitulo generado con contenido completo y coherente.

---

## 9. Ejecutar critica y revisar los seis criterios de adherencia

1. En la pagina del capitulo, abrir "Resultados de critica"
2. Hacer clic en "Criticar capitulo"
3. Revisar el resultado de la critica
4. Verificar los seis criterios de adherencia:

   | Criterio | Pregunta                                                                                        |
   | -------- | ----------------------------------------------------------------------------------------------- |
   | audience | El capitulo aborda la situacion, dolor y nivel de conciencia del lector primario?               |
   | promise  | El capitulo entrega la promesa central y respeta el limite realista?                            |
   | coverage | El capitulo cubre todos los mustCover y requiredScenarios del contrato?                         |
   | tone     | El capitulo usa el tono, postura y nivel de lectura prescritos?                                 |
   | ethics   | El capitulo respeta los principios eticos y evita afirmaciones/encuadres prohibidos?            |
   | evidence | Las afirmaciones factuales estan respaldadas por fuentes aprobadas o calificadas adecuadamente? |

**Resultado esperado:** la critica evalua los seis criterios y senala desviaciones especificas.

---

## 10. Corregir fallas detectadas

1. Si la critica encontro desviaciones, hacer clic en "Corregir"
2. Seleccionar el prompt corrector apropiado
3. Esperar a que se genere la correccion
4. Revisar el diff: antes/despues de cada correccion aplicada
5. Verificar que el hash del brief editorial coincida entre critica y correccion (heredado via snapshot)

**Resultado esperado:** capitulo corregido manteniendo voz, postura y sin introducir afirmaciones no soportadas.

---

## 11. Regenerar titulo bajo la misma version aprobada

1. Navegar a la seccion de titulo del proyecto
2. Verificar que use el empaque del brief (hook, angulo, terminos SEO)
3. Hacer clic en "Regenerar titulo"
4. Confirmar que el titulo generado refleje los terminos SEO y el angulo definidos
5. Verificar que NO herede sesgo del primer capitulo

**Resultado esperado:** titulo comercial coherente con el brief, sin arrastrar contenido de capitulos individuales.
