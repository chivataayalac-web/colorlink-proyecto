# COLORLINK: Transformación Digital Inteligente en Pintura y Recubrimientos

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115.0-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Streamlit](https://img.shields.io/badge/Streamlit-1.38.0-FF4B4B?logo=streamlit)](https://streamlit.io)
[![MySQL 8](https://img.shields.io/badge/MySQL-8.0-4479A1?logo=mysql)](https://www.mysql.com)
[![SQLAlchemy 2](https://img.shields.io/badge/SQLAlchemy-2.0-D71F00)](https://www.sqlalchemy.org)
[![Gemini AI](https://img.shields.io/badge/Gemini-3.7--Flash-4285F4?logo=google)](https://ai.google.dev)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://www.docker.com)
[![Pytest](https://img.shields.io/badge/Pytest-Passing-brightgreen?logo=pytest)](https://docs.pytest.org)

---

## 1. Resumen Ejecutivo y Arquitectura

**COLORLINK** es una plataforma de transformación digital empresarial diseñada para convertir necesidades no estructuradas de pintura, sellado y recubrimientos en soluciones técnicas, comerciales y operativas precisas, determinísticas y trazables.

### Diagrama de Arquitectura de Capas
```
┌─────────────────────────────────────────────────────────┐
│              USUARIOS (Roles: Admin, Asesor, Técnico, Cliente)│
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│                 FRONTEND (Streamlit)                    │
│   - Captura Guiada (Wizard) con Detección en Tiempo Real │
│   - Galería de Evidencias (SHA-256 + MIME + Previews)    │
│   - Inspección de Clasificación Gemini & Escalamiento   │
│   - Calculadora Técnica de Materiales y Presupuestos    │
│   - Historial de Estados y Auditoría                    │
└────────────────────────────┬────────────────────────────┘
                             │ Requests HTTP + JWT
                             ▼
┌─────────────────────────────────────────────────────────┐
│                 BACKEND REST API (FastAPI)              │
│   - api: Controladores y Endpoints v1                   │
│   - core: Seguridad JWT, Bcrypt, Configuración Pydantic  │
│   - schemas: Validación Pydantic v2                     │
│   - services:                                           │
│       * Motor de Validación en 5 Capas                  │
│       * Integrador Gemini 3.7 Flash Estructurado         │
│       * Motor de Cálculo Técnico de Rendimientos        │
│       * Detector de Solicitudes Duplicadas              │
│   - repositories: Acceso a Datos y Consultas            │
│   - models: Entidades Mapeadas SQLAlchemy 2.0           │
└──────────────┬────────────────────────────┬─────────────┘
               │                            │
               ▼                            ▼
┌──────────────────────────────┐ ┌─────────────────────────┐
│    BASE DE DATOS OFICIAL     │ │    GOOGLE GEMINI AI     │
│          (MySQL 8)           │ │  (gemini-3.7-flash)     │
│   - Migraciones con Alembic  │ │  - Extracción JSON      │
│   - Integridad Referencial   │ │  - Complejidad & Riesgo │
│   - Trazabilidad y Logs      │ │  - Detección Faltantes  │
└──────────────────────────────┘ └─────────────────────────┘
```

---

## 2. Matriz de Validación Técnica en 5 Capas

| Capa de Validación | Regla Aplicada | Comportamiento del Sistema |
| :--- | :--- | :--- |
| **A. Completitud** | Verificación de obligatoriedad en cliente, proyecto, consentimiento de datos y áreas. | Bloqueante (`422 Unprocessable Entity`) si falta algún campo crítico. |
| **B. Formato** | Área > 0, Email regex RFC 5322, Teléfono >= 7 dígitos, extensiones permitidas (`jpg`, `jpeg`, `png`, `pdf`), tamaño <= 15MB. | Bloqueante con detalle del campo infractor. |
| **C. Coherencia** | Fecha requerida en futuro; $\sum \text{Áreas} \le \text{Área Total}$; Fachada = Exterior. | Errores bloqueantes para fecha/áreas; Advertencia no bloqueante para Fachada en interior. |
| **D. Duplicidad** | Similitud de cliente, ciudad, tipo y descripción ($\pm 15\%$ área). | Advertencia informativa (`POSIBLE_DUPLICADO`) con puntaje de coincidencia. |
| **E. Trazabilidad** | Registro de usuario, timestamp UTC, hash SHA-256 de archivos, logs de validación y clasificaciones. | Inserción automática en `state_history`, `validation_logs` y `gemini_classifications`. |

---

## 3. Demostración del Caso Principal: Constructora Horizonte

- **Cliente**: Constructora Horizonte (NIT 900.987.654-3)
- **Ciudad**: Medellín
- **Proyecto**: Fachada de edificio residencial (85.00 m², concreto expuesto, color gris, exterior)
- **Condiciones**: Humedad y Fisuras
- **Fecha Requerida**: 20 días posteriores a la fecha de registro

### Resultado Técnico del Sistema:
1. **Validación**: Coherencia aprobada con alerta técnica por presencia de humedad y fisuras.
2. **Gemini AI**:
   - `categoria`: `RECUBRIMIENTO_EXTERIOR`
   - `complejidad`: `ALTA`
   - `requiere_especialista`: `true`
   - `datos_faltantes`: `["profundidad_de_fisuras", "origen_de_humedad"]`
   - `observaciones`: `["Se requiere revisión técnica antes de definir el sistema de acabado."]`
3. **Cálculo de Materiales**:
   - 5 galones de Masilla Elastomérica Sellagrietas Pro (`MAS-ELAST-01`)
   - 3 galones de Sellador Antihumedad Barrera de Vapor (`SEL-ANTI-HUM-01`)
   - 4 galones de Pintura Fachada Super Acrílica Grano Fino (`PIN-EXT-FACH-01`)

---

## 4. Despliegue con Docker y Docker Compose

```bash
# 1. Clonar el repositorio
git clone https://github.com/colorlink/colorlink-platform.git
cd colorlink-platform

# 2. Configurar variables de entorno
cp .env.example .env
# Configurar GEMINI_API_KEY en .env

# 3. Levantar contenedores MySQL 8 + FastAPI + Streamlit
docker-compose up --build -d

# 4. Acceder a los servicios:
# - Frontend Streamlit: http://localhost:8501
# - Backend FastAPI / Swagger: http://localhost:8000/api/v1/docs
# - Base de Datos MySQL: localhost:3306
```

---

## 5. Ejecución de Pruebas Automatizadas

```bash
cd backend
pytest -v
```
