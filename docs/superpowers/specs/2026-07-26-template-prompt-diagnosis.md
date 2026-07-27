# Diagnóstico: Saturación del patrón "No es X, es Y" en capítulos generados

**Fecha**: 2026-07-26
**Template**: `db5b4a3d-1160-4723-8d29-397f74eb8a09` (James Clear - 5.13)
**Capítulo analizado**: `7695ec41-1e63-4305-8de4-68e1bc08e55d` (Capítulo 1)
**Assembly**: `4a89aefc-beb4-4d46-a0f2-f1a157133329` (batched-direct-v1)

---

## 1. Cuantificación del problema

Texto ensamblado: ~10,000 palabras, ~100 párrafos.

| Patrón retórico                       | Conteo  |
| ------------------------------------- | ------- |
| `no ... sino ...`                     | 12      |
| `No es [X]` (definición por negación) | 9       |
| `En cambio` (transición de contraste) | 5       |
| `sino que`                            | 2       |
| **Total patrones contraste/negación** | **~28** |

**Densidad: 1 patrón de contraste cada 3-4 párrafos.** El lector percibe una muletilla, no un recurso estilístico ocasional.

Ejemplos del capítulo:

- "Su eficacia **no** se mide por lo ingenioso o impresionante que sea, **sino** por su capacidad para generar una conversación bidireccional."
- "**No es** un cumplido genérico ni un piropo vacío."
- "**No es** una declaración intensa o de intenciones prematuras."
- "**No se trata de** memorizar la mejor frase, **sino de** entender el principio."
- "**En cambio**, un primer mensaje efectivo **no es** un cumplido genérico..."
- "**No** demuestra quién eres como jugador, **sino que** invita a jugar."
- "La diferencia **no** está en la originalidad, **sino** en la fricción cognitiva."
- "**No por defecto, sino por contraste**."
- "**No es** un guion rígido, **sino** el hábito de apoyarse en un detalle real."

---

## 2. Causa raíz: los prompts del template

El template tiene **49 prompts de contenido** por capítulo (×2 capítulos). De ellos, **21 (43%)** fuerzan estructuras binarias de contraste o negación.

### 2.1 Prompts de ALTO RIESGO — Ordenan explícitamente "qué es y qué no es"

Estos prompts **instruyen directamente al LLM** a generar listas de negaciones:

| Pos | ID         | Función                                       | Contenido                                                                             |
| --- | ---------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `6545dbb7` | Definición operativa que delimita el concepto | `Define operativamente {concepto_2}. **Delimita qué es y qué no es {concepto_2}.**`   |
| 19  | `a7e8e79e` | Definición operativa que delimita el concepto | `Define operativamente {concepto_8}. **Delimita qué es y qué no es {concepto_8}.**`   |
| 27  | `2a54579e` | Definición operativa que delimita el concepto | `Define operativamente {concepto_10}. **Delimita qué es y qué no es {concepto_10}.**` |
| 46  | `95b6fc81` | Definición operativa que delimita el concepto | `Define operativamente {concepto_13}. **Delimita qué es y qué no es {concepto_13}.**` |

**Fragmento generado por este prompt (ejemplo real):**

```
**Lo que es:**
- Un puente entre el contacto inicial y una conversación posible.
- Una muestra de respeto por el tiempo y la atención del otro.

**Lo que no es:**
- No es un cumplido genérico ni un piropo vacío.
- No es una declaración intensa o de intenciones prematuras.
- No es un mensaje trampa o una estrategia manipulativa.
- No es un ensayo de ingeniería social.
- No es un sistema para "conquistar" o "garantizar" resultados.
```

Cada uno de estos 4 prompts genera ~5-7 oraciones de tipo "No es X". **20-28 negaciones solo de esta fuente.**

### 2.2 Prompts de RIESGO MEDIO-ALTO — Fuerzan estructura binaria de contraste

| Pos | ID         | Función                                      | Problema                                                          |
| --- | ---------- | -------------------------------------------- | ----------------------------------------------------------------- |
| 5   | `b81dbd4d` | Contraste entre la afirmación y una objeción | `Contrasta {pregunta_1} con {objecion_1}. Muestra las dos caras.` |
| 8   | `623e702b` | Objeción sólida presentada con honestidad    | `Presenta la objeción más sólida... No la debilites.`             |
| 9   | `b0990cad` | Respuesta que integra la objeción            | `Reconoce el valor de la objeción antes de responder.`            |
| 14  | `b65fd867` | Comparación de dos perspectivas              | `Por un lado {ejemplo_4}. Por otro {objecion_3}.`                 |
| 20  | `361009fe` | Objeción sólida                              | (segunda ronda)                                                   |
| 21  | `8ad25145` | Respuesta que integra la objeción            | (segunda ronda)                                                   |
| 26  | `308955c6` | Contraste entre la afirmación y una objeción | (segunda ronda)                                                   |
| 28  | `189979a9` | Comparación de dos perspectivas              | (segunda ronda)                                                   |
| 32  | `b6c881f0` | Objeción sólida                              | (tercera ronda)                                                   |
| 33  | `73ee3058` | Respuesta que integra la objeción            | (tercera ronda)                                                   |
| 35  | `871b1ad0` | Objeción sólida                              | (cuarta ronda)                                                    |
| 37  | `0f24a234` | Objeción sólida                              | (quinta ronda)                                                    |
| 39  | `0f8d3fec` | Respuesta que integra la objeción            | (cuarta ronda)                                                    |
| 40  | `4e77ba0e` | Objeción sólida                              | (sexta ronda)                                                     |
| 41  | `9252515d` | Respuesta que integra la objeción            | (quinta ronda)                                                    |
| 42  | `cf2f09d6` | Objeción sólida                              | (séptima ronda)                                                   |
| 43  | `01ed06ff` | Respuesta que integra la objeción            | (sexta ronda)                                                     |

**17 prompts** que fuerzan estructura tesis → antítesis → síntesis. El patrón se repite 6 veces (objeción → respuesta) dentro del mismo capítulo.

### 2.3 Estructura completa del capítulo (49 prompts)

```
Pos 0:    Apertura con caso concreto                         [neutro]
Pos 1:    Definición operativa (qué es / qué no es)           [ALTO - niega]
Pos 2-3:  Evidencia + Evidencia numérica                     [neutro]
Pos 4:    Transición                                          [neutro]
Pos 5:    Contraste entre afirmación y objeción               [MEDIO - binario]
Pos 6:    Evidencia numérica                                  [neutro]
Pos 7:    Analogía                                            [neutro]
Pos 8-9:  Objeción → Respuesta                                [MEDIO - binario]
Pos 10:   Analogía                                            [neutro]
Pos 11-13: Aplicación → Evidencia → Aplicación                [neutro]
Pos 14:   Comparación de dos perspectivas                     [MEDIO - binario]
Pos 15-16: Cierre → Transición                               [neutro]
Pos 17-18: Analogía + Evidencia                               [neutro]
Pos 19:   Definición operativa (qué es / qué no es)           [ALTO - niega]
Pos 20-21: Objeción → Respuesta                               [MEDIO - binario]
Pos 22-23: Analogía → Cierre                                  [neutro]
Pos 24-25: Transición → Transición                            [neutro]
Pos 26:   Contraste entre afirmación y objeción               [MEDIO - binario]
Pos 27:   Definición operativa (qué es / qué no es)           [ALTO - niega]
Pos 28:   Comparación de dos perspectivas                     [MEDIO - binario]
Pos 29:   Transición                                          [neutro]
Pos 30:   Afirmación central                                  [neutro]
Pos 31:   Evidencia                                           [neutro]
Pos 32-33: Objeción → Respuesta                               [MEDIO - binario]
Pos 34:   Transición                                          [neutro]
Pos 35:   Objeción                                            [MEDIO - binario]
Pos 36:   Evidencia                                           [neutro]
Pos 37:   Objeción                                            [MEDIO - binario]
Pos 38:   Analogía                                            [neutro]
Pos 39:   Respuesta                                           [MEDIO - binario]
Pos 40-41: Objeción → Respuesta                               [MEDIO - binario]
Pos 42-43: Objeción → Respuesta                               [MEDIO - binario]
Pos 44:   Transición                                          [neutro]
Pos 45:   Afirmación central                                  [neutro]
Pos 46:   Definición operativa (qué es / qué no es)           [ALTO - niega]
Pos 47-48: Analogía → Cierre                                  [neutro]
```

**21/49 = 43% de los prompts** empujan al LLM hacia estructuras de negación o contraste binario.

---

## 3. Por qué el assembly lo amplifica

El algoritmo `batched-direct-v1` ensambla 49 fragmentos secuencialmente. Si ~21 fragmentos usan la misma estructura retórica (negación → afirmación, tesis → antítesis), el texto final acumula densidad mecánicamente.

El assembly no tiene:

- Detección de patrones retóricos repetidos
- Smoothing estilístico entre fragmentos
- Variación de estructuras argumentales

---

## 4. Propuesta de reescritura

### 4.1 Principios

1. **Definir en positivo.** No decir "qué no es" — decir "qué es" con precisión. Los límites se expresan como alcance natural, no como lista de exclusiones.
2. **Una objeción por capítulo, máximo dos.** La estructura objeción→respuesta es efectiva una vez. Repetida 6 veces satura.
3. **Variar estructuras argumentales.** Alternar entre: caso→principio, evidencia→implicación, analogía→aplicación, pregunta→respuesta. No todo es tesis→antítesis.
4. **Transiciones sin contraste.** Conectar secciones por consecuencia lógica ("esto implica que..."), no por oposición ("en cambio...").

### 4.2 Rewrites concretos

#### Prompt tipo "Definición operativa" (4 instancias: pos 1, 19, 27, 46)

**Actual:**

```
Define operativamente {concepto_2}. Delimita qué es y qué no es {concepto_2}.
```

**Propuesto:**

```
Define operativamente {concepto_2}. Describe sus propiedades esenciales,
su alcance natural y las condiciones bajo las cuales se aplica.
No uses listas de negaciones ("no es X", "no es Y").
Expresa los límites como afirmaciones positivas sobre dónde y cuándo
el concepto es útil.
```

**Nota para el admin del template**: si el libro requiere la estructura "qué es / qué no es", limitarla a **1 prompt por capítulo** (el primero), no 4. Los otros 3 se reemplazan por "Aplicación práctica" o "Evidencia adicional".

#### Prompt tipo "Contraste / Objeción → Respuesta" (reducir de 17 a ~4)

**Eliminar** 13 de los 17 prompts de objeción/respuesta/contraste/comparación.

**Reemplazar por** variantes sin estructura binaria:

- **"Perspectiva complementaria"** (reemplaza "Contraste"):

  ```
  Explora una dimensión adicional de {concepto}: {perspectiva_1}.
  No la enfrentes a la idea anterior — muéstrala como una capa
  que enriquece la comprensión del lector.
  ```

- **"Pregunta del lector"** (reemplaza "Objeción"):

  ```
  Anticipa una pregunta genuina que el lector podría hacerse sobre
  {concepto}: {pregunta_1}. Responde desde la experiencia práctica,
  no desde la refutación teórica.
  ```

- **"Matiz importante"** (reemplaza "Respuesta a objeción"):
  ```
  Añade un matiz importante a la idea anterior: {matiz_1}.
  No niegues lo dicho — afínalo. Muestra cuándo aplica y cuándo
  conviene ajustar el enfoque.
  ```

### 4.3 Estructura propuesta (49 → 49 prompts, redistribuidos)

```
 0: Apertura con caso concreto
 1: Definición operativa (positiva, sin lista de negaciones)    [REESCRITO]
 2: Evidencia
 3: Evidencia numérica
 4: Transición
 5: Perspectiva complementaria                                   [REESCRITO - era Contraste]
 6: Evidencia numérica
 7: Analogía
 8: Objeción → Respuesta (única ronda)                          [CONSERVADO - 1 solo]
 9: [eliminado, absorbido por 8]
10: Analogía
11: Aplicación práctica
12: Evidencia                                                    [era objeción/respuesta]
13: Aplicación práctica                                          [era objeción/respuesta]
14: Matiz importante                                             [REESCRITO - era Comparación]
15: Cierre de sección
16: Transición
17: Analogía
18: Evidencia                                                    [era objeción/respuesta]
19: Aplicación práctica                                          [REESCRITO - era Definición operativa]
20: Pregunta del lector → Respuesta                              [REESCRITO - era Objeción/Respuesta]
21: [eliminado, absorbido por 20]
22: Analogía
23: Cierre de sección
24: Transición
25: Transición
26: Perspectiva complementaria                                   [REESCRITO - era Contraste]
27: Evidencia adicional                                          [REESCRITO - era Def. operativa]
28: Aplicación práctica                                          [REESCRITO - era Comparación]
29: Transición
30: Afirmación central
31: Evidencia
32: Pregunta del lector → Respuesta                              [REESCRITO - era Objeción/Respuesta]
33: [eliminado, absorbido por 32]
34: Transición
35: Ejemplo concretos                                            [REESCRITO - era Objeción]
36: Evidencia                                                    [era Objeción]
37: Analogía                                                     [REESCRITO - era Objeción]
38: Aplicación práctica                                          [era Respuesta]
39: Evidencia                                                    [era Respuesta]
40: Matiz importante                                             [REESCRITO - era Objeción/Respuesta]
41: [eliminado, absorbido por 40]
42: Evidencia                                                    [REESCRITO - era Objeción/Respuesta]
43: [eliminado, absorbido por 42]
44: Transición
45: Afirmación central
46: Aplicación práctica                                          [REESCRITO - era Def. operativa]
47: Analogía
48: Cierre
```

**Cambio neto**: 4 definiciones operativas → 1, 17 patrones binarios → 6 variantes no binarias.

---

## 5. Implementación

Los prompts se editan desde el panel de admin: `/admin/books/`.

Alternativa: migración SQL que actualice los `content` y `user_prompt` de los 21 prompts identificados.

Antes de aplicar, regenerar el capítulo para validar que el cambio reduce efectivamente la densidad de patrones "no es X, es Y".
