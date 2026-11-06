-- ==========================================================
-- COLORLINK: ESQUEMA OFICIAL DE BASE DE DATOS PARA SUPABASE (POSTGRESQL)
-- Ejecutar este script completo en el SQL Editor de Supabase
-- ==========================================================

-- Habilitar extensión para UUIDs si se requiere
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabla de Usuarios del Sistema
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(150) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'CLIENTE' CHECK (role IN ('ADMIN', 'ASESOR', 'TECNICO', 'CLIENTE')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1.1 Tabla de Códigos OTP de Verificación de Correo
CREATE TABLE IF NOT EXISTS user_verification_codes (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(150) NOT NULL,
    code VARCHAR(10) NOT NULL,
    purpose VARCHAR(50) NOT NULL DEFAULT 'USER_REGISTRATION',
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_verif_email_code ON user_verification_codes(email, code);

-- 2. Tabla de Clientes
CREATE TABLE IF NOT EXISTS clients (
    id BIGSERIAL PRIMARY KEY,
    doc_type VARCHAR(20) NOT NULL DEFAULT 'NIT',
    doc_number VARCHAR(50) NOT NULL UNIQUE,
    company_name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    entry_channel VARCHAR(50) NOT NULL DEFAULT 'PORTAL_WEB',
    data_consent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_doc ON clients(doc_number);
CREATE INDEX IF NOT EXISTS idx_client_name ON clients(company_name);

-- 3. Tabla de Proyectos
CREATE TABLE IF NOT EXISTS projects (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    city VARCHAR(100) NOT NULL,
    project_type VARCHAR(100) NOT NULL,
    total_area NUMERIC(10, 2) NOT NULL CHECK (total_area > 0),
    required_date TIMESTAMPTZ NOT NULL,
    description TEXT NOT NULL,
    responsible_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    current_status VARCHAR(50) NOT NULL DEFAULT 'REGISTRADO' 
        CHECK (current_status IN ('BORRADOR', 'REGISTRADO', 'VALIDADO', 'CLASIFICADO_IA', 'EN_REVISION_TECNICA', 'PRESUPUESTADO', 'APROBADO', 'EN_EJECUCION', 'FINALIZADO')),
    requires_specialist BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_code ON projects(code);
CREATE INDEX IF NOT EXISTS idx_project_client ON projects(client_id);

-- 4. Tabla de Áreas Técnicas del Proyecto
CREATE TABLE IF NOT EXISTS project_areas (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    area_m2 NUMERIC(10, 2) NOT NULL CHECK (area_m2 > 0),
    surface VARCHAR(100) NOT NULL,
    environment VARCHAR(50) NOT NULL,
    color VARCHAR(50) NOT NULL,
    conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    technical_description TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_area_project ON project_areas(project_id);

-- 5. Tabla de Evidencias Fotográficas
CREATE TABLE IF NOT EXISTS project_evidences (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    area_id BIGINT REFERENCES project_areas(id) ON DELETE SET NULL,
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    storage_path VARCHAR(500) NOT NULL,
    description VARCHAR(255) NULL,
    uploaded_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evidence_project ON project_evidences(project_id);
CREATE INDEX IF NOT EXISTS idx_evidence_hash ON project_evidences(sha256_hash);

-- 6. Tabla de Logs de Validación Automática
CREATE TABLE IF NOT EXISTS validation_logs (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    valido BOOLEAN NOT NULL,
    errores JSONB NOT NULL DEFAULT '[]'::jsonb,
    advertencias JSONB NOT NULL DEFAULT '[]'::jsonb,
    posibles_duplicados JSONB NOT NULL DEFAULT '[]'::jsonb,
    validated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Tabla de Clasificaciones Gemini
CREATE TABLE IF NOT EXISTS gemini_classifications (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    model_used VARCHAR(100) NOT NULL,
    categoria VARCHAR(100) NOT NULL,
    condiciones_detectadas JSONB NOT NULL DEFAULT '[]'::jsonb,
    complejidad VARCHAR(20) NOT NULL,
    requiere_especialista BOOLEAN NOT NULL,
    nivel_confianza NUMERIC(4, 2) NOT NULL,
    datos_faltantes JSONB NOT NULL DEFAULT '[]'::jsonb,
    observaciones JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_response TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Tabla de Historial de Estados (Trazabilidad)
CREATE TABLE IF NOT EXISTS state_history (
    id BIGSERIAL PRIMARY KEY,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    previous_state VARCHAR(50) NULL,
    new_state VARCHAR(50) NOT NULL,
    changed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    comment TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Tabla de Notificaciones por Correo Electrónico
CREATE TABLE IF NOT EXISTS email_notifications (
    id BIGSERIAL PRIMARY KEY,
    email_uuid VARCHAR(100) NOT NULL UNIQUE,
    project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
    recipient_email VARCHAR(150) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    total_cop NUMERIC(14, 2) DEFAULT 0,
    transport_method VARCHAR(50) NOT NULL DEFAULT 'SMTP',
    status VARCHAR(50) NOT NULL DEFAULT 'DELIVERED',
    message_id VARCHAR(255) NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Catálogo de Inventario de Recubrimientos
CREATE TABLE IF NOT EXISTS inventory_items (
    id BIGSERIAL PRIMARY KEY,
    sku VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100) NOT NULL,
    surface_compatibility JSONB NOT NULL DEFAULT '[]'::jsonb,
    yield_m2_per_gal NUMERIC(8, 2) NOT NULL,
    recommended_coats INT NOT NULL DEFAULT 2,
    unit VARCHAR(20) NOT NULL DEFAULT 'GALON',
    stock_qty NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
    unit_price_cop NUMERIC(12, 2) NOT NULL DEFAULT 0.0
);

-- ==========================================================
-- POLÍTICAS DE ACCESO ROW LEVEL SECURITY (RLS)
-- Habilita lectura e inserción para el cliente anónimo (anon public)
-- ==========================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gemini_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE state_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

-- Políticas para acceso público/anon (frontend)
DO $$ 
BEGIN
    -- users
    EXECUTE 'CREATE POLICY "Public read users" ON users FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert users" ON users FOR INSERT WITH CHECK (true);';
    EXECUTE 'CREATE POLICY "Public update users" ON users FOR UPDATE USING (true);';

    -- user_verification_codes
    EXECUTE 'CREATE POLICY "Public read user_verification_codes" ON user_verification_codes FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert user_verification_codes" ON user_verification_codes FOR INSERT WITH CHECK (true);';
    EXECUTE 'CREATE POLICY "Public update user_verification_codes" ON user_verification_codes FOR UPDATE USING (true);';

    -- clients
    EXECUTE 'CREATE POLICY "Public read clients" ON clients FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert clients" ON clients FOR INSERT WITH CHECK (true);';

    -- projects
    EXECUTE 'CREATE POLICY "Public read projects" ON projects FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert projects" ON projects FOR INSERT WITH CHECK (true);';
    EXECUTE 'CREATE POLICY "Public update projects" ON projects FOR UPDATE USING (true);';

    -- project_areas
    EXECUTE 'CREATE POLICY "Public read project_areas" ON project_areas FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert project_areas" ON project_areas FOR INSERT WITH CHECK (true);';

    -- project_evidences
    EXECUTE 'CREATE POLICY "Public read project_evidences" ON project_evidences FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert project_evidences" ON project_evidences FOR INSERT WITH CHECK (true);';

    -- validation_logs
    EXECUTE 'CREATE POLICY "Public read validation_logs" ON validation_logs FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert validation_logs" ON validation_logs FOR INSERT WITH CHECK (true);';

    -- gemini_classifications
    EXECUTE 'CREATE POLICY "Public read gemini_classifications" ON gemini_classifications FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert gemini_classifications" ON gemini_classifications FOR INSERT WITH CHECK (true);';

    -- state_history
    EXECUTE 'CREATE POLICY "Public read state_history" ON state_history FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert state_history" ON state_history FOR INSERT WITH CHECK (true);';

    -- email_notifications
    EXECUTE 'CREATE POLICY "Public read email_notifications" ON email_notifications FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert email_notifications" ON email_notifications FOR INSERT WITH CHECK (true);';

    -- inventory_items
    EXECUTE 'CREATE POLICY "Public read inventory_items" ON inventory_items FOR SELECT USING (true);';
    EXECUTE 'CREATE POLICY "Public insert inventory_items" ON inventory_items FOR INSERT WITH CHECK (true);';
EXCEPTION 
    WHEN duplicate_object THEN NULL;
END $$;

-- ==========================================================
-- SEMBRADO DE DATOS MAESTROS INICIALES EN SUPABASE
-- ==========================================================

INSERT INTO users (email, hashed_password, full_name, role, is_active) VALUES
('admin@colorlink.com', '$2b$12$4mI6v3mQ3.y9Zl7P8F/xjeP1h0fQ51Uv6K9d1C0eT1Vv9O7N4b9yS', 'Ing. Carlos Mendoza (Admin)', 'ADMIN', TRUE),
('asesor@colorlink.com', '$2b$12$4mI6v3mQ3.y9Zl7P8F/xjeP1h0fQ51Uv6K9d1C0eT1Vv9O7N4b9yS', 'María Elena Gómez (Asesora)', 'ASESOR', TRUE),
('tecnico@colorlink.com', '$2b$12$4mI6v3mQ3.y9Zl7P8F/xjeP1h0fQ51Uv6K9d1C0eT1Vv9O7N4b9yS', 'Arq. David Valencia (Técnico)', 'TECNICO', TRUE),
('cliente@horizonte.com', '$2b$12$4mI6v3mQ3.y9Zl7P8F/xjeP1h0fQ51Uv6K9d1C0eT1Vv9O7N4b9yS', 'Constructora Horizonte', 'CLIENTE', TRUE)
ON CONFLICT (email) DO NOTHING;

INSERT INTO inventory_items (sku, name, category, surface_compatibility, yield_m2_per_gal, recommended_coats, unit, stock_qty, unit_price_cop) VALUES
('MAS-ELAST-01', 'Masilla Elastomérica Sellagrietas Pro', 'TRATAMIENTO_FISURAS', '["concreto", "mamposteria", "estuco"]'::jsonb, 20.0, 1, 'GALON', 85.0, 34500.0),
('SEL-ANTI-HUM-01', 'Sellador Antihumedad e Hidrofugante Acrílico', 'IMPRIMACION_SELLADO', '["concreto", "mamposteria"]'::jsonb, 30.0, 1, 'GALON', 64.0, 78900.0),
('PIN-EXT-FACH-01', 'Pintura Fachada Exterior Super Acrílica Grano Fino (Gris)', 'ACABADO_FINAL', '["concreto", "mamposteria"]'::jsonb, 25.0, 2, 'GALON', 140.0, 96500.0),
('IMP-POLI-01', 'Impermeabilizante Poliuretano Alta Resistencia', 'IMPERMEABILIZACION', '["concreto", "metal"]'::jsonb, 18.0, 2, 'GALON', 42.0, 125000.0)
ON CONFLICT (sku) DO NOTHING;
