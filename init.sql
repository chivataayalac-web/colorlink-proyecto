-- ==========================================================
-- COLORLINK: BASE DE DATOS OFICIAL MYSQL 8
-- Script de Inicialización y Sembrado de Esquema y Catálogos
-- ==========================================================

CREATE DATABASE IF NOT EXISTS colorlink_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE colorlink_db;

-- 1. Tabla de Usuarios
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(150) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role ENUM('ADMIN', 'ASESOR', 'TECNICO', 'CLIENTE') NOT NULL DEFAULT 'ASESOR',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_email (email)
) ENGINE=InnoDB;

-- 1.1 Tabla de Códigos de Verificación de Correo (OTP)
CREATE TABLE IF NOT EXISTS user_verification_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(150) NOT NULL,
    code VARCHAR(10) NOT NULL,
    purpose VARCHAR(50) NOT NULL DEFAULT 'USER_REGISTRATION',
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_verif_email_code (email, code),
    INDEX idx_verif_expires (expires_at)
) ENGINE=InnoDB;

-- 2. Tabla de Clientes
CREATE TABLE IF NOT EXISTS clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doc_type VARCHAR(20) NOT NULL DEFAULT 'NIT',
    doc_number VARCHAR(50) NOT NULL UNIQUE,
    company_name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    entry_channel VARCHAR(50) NOT NULL DEFAULT 'PORTAL_WEB',
    data_consent BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_client_doc (doc_number),
    INDEX idx_client_name (company_name)
) ENGINE=InnoDB;

-- 3. Tabla de Proyectos
CREATE TABLE IF NOT EXISTS projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    client_id INT NOT NULL,
    name VARCHAR(200) NOT NULL,
    city VARCHAR(100) NOT NULL,
    project_type VARCHAR(100) NOT NULL,
    total_area DOUBLE NOT NULL,
    required_date DATETIME NOT NULL,
    description TEXT NOT NULL,
    responsible_user_id INT NULL,
    current_status ENUM('BORRADOR', 'REGISTRADO', 'VALIDADO', 'CLASIFICADO_IA', 'EN_REVISION_TECNICA', 'PRESUPUESTADO', 'APROBADO', 'EN_EJECUCION', 'FINALIZADO') NOT NULL DEFAULT 'REGISTRADO',
    requires_specialist BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_project_code (code),
    INDEX idx_project_city (city)
) ENGINE=InnoDB;

-- 4. Tabla de Áreas Técnicas de Proyecto
CREATE TABLE IF NOT EXISTS project_areas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    name VARCHAR(150) NOT NULL,
    area_m2 DOUBLE NOT NULL,
    surface VARCHAR(100) NOT NULL,
    environment VARCHAR(50) NOT NULL,
    color VARCHAR(50) NOT NULL,
    conditions JSON NOT NULL,
    technical_description TEXT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 5. Tabla de Evidencias Fotográficas y Documentales
CREATE TABLE IF NOT EXISTS project_evidences (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    area_id INT NULL,
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes INT NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    storage_path VARCHAR(500) NOT NULL,
    description VARCHAR(255) NULL,
    uploaded_by_user_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (area_id) REFERENCES project_areas(id) ON DELETE SET NULL,
    FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_evidence_hash (sha256_hash)
) ENGINE=InnoDB;

-- 6. Tabla de Logs de Validación Automática
CREATE TABLE IF NOT EXISTS validation_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    valido BOOLEAN NOT NULL,
    errores JSON NOT NULL,
    advertencias JSON NOT NULL,
    posibles_duplicados JSON NOT NULL,
    validated_by_user_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (validated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 7. Tabla de Clasificaciones Gemini
CREATE TABLE IF NOT EXISTS gemini_classifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    model_used VARCHAR(100) NOT NULL,
    categoria VARCHAR(100) NOT NULL,
    condiciones_detectadas JSON NOT NULL,
    complejidad VARCHAR(20) NOT NULL,
    requiere_especialista BOOLEAN NOT NULL,
    nivel_confianza DOUBLE NOT NULL,
    datos_faltantes JSON NOT NULL,
    observaciones JSON NOT NULL,
    raw_response TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 8. Tabla de Historial de Estados (Trazabilidad)
CREATE TABLE IF NOT EXISTS state_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    previous_state VARCHAR(50) NULL,
    new_state VARCHAR(50) NOT NULL,
    changed_by_user_id INT NULL,
    comment TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 9. Tabla de Inventario de Recubrimientos
CREATE TABLE IF NOT EXISTS inventory_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sku VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(100) NOT NULL,
    surface_compatibility JSON NOT NULL,
    yield_m2_per_gal DOUBLE NOT NULL,
    recommended_coats INT NOT NULL DEFAULT 2,
    unit VARCHAR(20) NOT NULL DEFAULT 'GALON',
    stock_qty DOUBLE NOT NULL DEFAULT 0.0,
    unit_price_cop DOUBLE NOT NULL DEFAULT 0.0
) ENGINE=InnoDB;

-- Sembrado Inicial de Usuarios
INSERT INTO users (email, hashed_password, full_name, role, is_active) VALUES
('admin@colorlink.com', '$2b$12$4mI6v3mQ3.y9Zl7P8F/xjeP1h0fQ51Uv6K9d1C0eT1Vv9O7N4b9yS', 'Ing. Carlos Mendoza (Admin)', 'ADMIN', TRUE),
('asesor@colorlink.com', '$2b$12$4mI6v3mQ3.y9Zl7P8F/xjeP1h0fQ51Uv6K9d1C0eT1Vv9O7N4b9yS', 'María Elena Gómez (Asesora)', 'ASESOR', TRUE),
('tecnico@colorlink.com', '$2b$12$4mI6v3mQ3.y9Zl7P8F/xjeP1h0fQ51Uv6K9d1C0eT1Vv9O7N4b9yS', 'Arq. David Valencia (Técnico)', 'TECNICO', TRUE),
('cliente@horizonte.com', '$2b$12$4mI6v3mQ3.y9Zl7P8F/xjeP1h0fQ51Uv6K9d1C0eT1Vv9O7N4b9yS', 'Constructora Horizonte', 'CLIENTE', TRUE)
ON DUPLICATE KEY UPDATE id=id;

-- Sembrado Inicial de Inventario
INSERT INTO inventory_items (sku, name, category, surface_compatibility, yield_m2_per_gal, recommended_coats, unit, stock_qty, unit_price_cop) VALUES
('MAS-ELAST-01', 'Masilla Elastomérica Sellagrietas Pro', 'TRATAMIENTO_FISURAS', '["concreto", "mamposteria", "estuco"]', 20.0, 1, 'GALON', 85.0, 34500.0),
('SEL-ANTI-HUM-01', 'Sellador Antihumedad e Hidrofugante Acrílico', 'IMPRIMACION_SELLADO', '["concreto", "mamposteria"]', 30.0, 1, 'GALON', 64.0, 78900.0),
('PIN-EXT-FACH-01', 'Pintura Fachada Exterior Super Acrílica Grano Fino (Gris)', 'ACABADO_FINAL', '["concreto", "mamposteria"]', 25.0, 2, 'GALON', 140.0, 96500.0),
('IMP-POLI-01', 'Impermeabilizante Poliuretano Alta Resistencia', 'IMPERMEABILIZACION', '["concreto", "metal"]', 18.0, 2, 'GALON', 42.0, 125000.0)
ON DUPLICATE KEY UPDATE id=id;
