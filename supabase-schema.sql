-- ============================================
-- UNITEC Sistema de Contenedores en Tránsito
-- Supabase Database Schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLA: Contenedores
-- ============================================
CREATE TABLE contenedores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre VARCHAR(255) NOT NULL,
  numero_contenedor VARCHAR(50) UNIQUE NOT NULL,
  booking VARCHAR(100),
  destino VARCHAR(255) NOT NULL,
  puerto VARCHAR(255),
  eta DATE,
  estado VARCHAR(50) DEFAULT 'en_transito', -- en_transito, en_puerto, llegado
  notas TEXT,
  fecha_salida DATE,
  fecha_llegada_real DATE,
  progreso INTEGER DEFAULT 0, -- 0-100
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: Productos en Contenedores
-- ============================================
CREATE TABLE contenedor_productos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contenedor_id UUID REFERENCES contenedores(id) ON DELETE CASCADE,
  ref_code VARCHAR(50) NOT NULL,
  nombre_producto VARCHAR(255) NOT NULL,
  cantidad INTEGER NOT NULL,
  unidad VARCHAR(20) DEFAULT 'unidades',
  peso_kg DECIMAL(10,2),
  volumen_m3 DECIMAL(10,3),
  valor_usd DECIMAL(12,2),
  notas TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: Historial de Estados
-- ============================================
CREATE TABLE contenedor_historial (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contenedor_id UUID REFERENCES contenedores(id) ON DELETE CASCADE,
  estado_anterior VARCHAR(50),
  estado_nuevo VARCHAR(50) NOT NULL,
  ubicacion VARCHAR(255),
  notas TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- TABLA: Documentos Asociados
-- ============================================
CREATE TABLE contenedor_documentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contenedor_id UUID REFERENCES contenedores(id) ON DELETE CASCADE,
  tipo VARCHAR(50) NOT NULL, -- bl, invoice, packing_list, certificate
  nombre VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  tamano_bytes BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- ÍNDICES
-- ============================================
CREATE INDEX idx_contenedores_estado ON contenedores(estado);
CREATE INDEX idx_contenedores_eta ON contenedores(eta);
CREATE INDEX idx_contenedores_destino ON contenedores(destino);
CREATE INDEX idx_contenedores_numero ON contenedores(numero_contenedor);
CREATE INDEX idx_productos_contenedor ON contenedor_productos(contenedor_id);
CREATE INDEX idx_historial_contenedor ON contenedor_historial(contenedor_id);
CREATE INDEX idx_historial_fecha ON contenedor_historial(created_at DESC);
CREATE INDEX idx_documentos_contenedor ON contenedor_documentos(contenedor_id);

-- ============================================
-- TRIGGER para actualizar updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contenedores_updated_at
  BEFORE UPDATE ON contenedores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- TRIGGER para registrar cambios de estado
-- ============================================
CREATE OR REPLACE FUNCTION registrar_cambio_estado()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.estado IS DISTINCT FROM NEW.estado THEN
    INSERT INTO contenedor_historial (contenedor_id, estado_anterior, estado_nuevo, ubicacion)
    VALUES (NEW.id, OLD.estado, NEW.estado, NEW.puerto);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cambio_estado
  AFTER UPDATE ON contenedores
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado)
  EXECUTE FUNCTION registrar_cambio_estado();

-- ============================================
-- TRIGGER para actualizar progreso automático
-- ============================================
CREATE OR REPLACE FUNCTION actualizar_progreso()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estado = 'llegado' THEN
    NEW.progreso := 100;
    NEW.fecha_llegada_real := CURRENT_DATE;
  ELSIF NEW.estado = 'en_puerto' THEN
    NEW.progreso := GREATEST(NEW.progreso, 85);
  ELSIF NEW.estado = 'en_transito' AND NEW.progreso < 10 THEN
    NEW.progreso := 10;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_actualizar_progreso
  BEFORE INSERT OR UPDATE ON contenedores
  FOR EACH ROW EXECUTE FUNCTION actualizar_progreso();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE contenedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE contenedor_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE contenedor_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE contenedor_documentos ENABLE ROW LEVEL SECURITY;

-- Políticas públicas (ajustar según autenticación)
CREATE POLICY "Enable read access for all users" ON contenedores FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON contenedores FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON contenedores FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON contenedores FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON contenedor_productos FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON contenedor_productos FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for all users" ON contenedor_productos FOR UPDATE USING (true);
CREATE POLICY "Enable delete for all users" ON contenedor_productos FOR DELETE USING (true);

CREATE POLICY "Enable read access for all users" ON contenedor_historial FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON contenedor_historial FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable read access for all users" ON contenedor_documentos FOR SELECT USING (true);
CREATE POLICY "Enable insert for all users" ON contenedor_documentos FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable delete for all users" ON contenedor_documentos FOR DELETE USING (true);

-- ============================================
-- DATOS DE EJEMPLO
-- ============================================

-- Contenedores de ejemplo
INSERT INTO contenedores (nombre, numero_contenedor, booking, destino, puerto, eta, estado, progreso) VALUES
('PISO LANDY 38', 'CMAU2654176', 'BOK001', 'El Salvador', 'Puerto de Acajutla', '2026-06-15', 'en_transito', 65),
('FACHADA WOODMAX', 'TEMU8765432', 'BOK002', 'Miami', 'Port of Miami', '2026-05-20', 'en_puerto', 85),
('DECKING WPC MIX', 'HLCU3456789', 'BOK003', 'República Dominicana', 'Puerto Caucedo', '2026-07-01', 'en_transito', 45);

-- Productos de ejemplo para primer contenedor
INSERT INTO contenedor_productos (contenedor_id, ref_code, nombre_producto, cantidad, peso_kg, valor_usd) 
SELECT id, '14031001', 'PISO SPC LANDY 38', 150, 2500.00, 4200.00 FROM contenedores WHERE numero_contenedor = 'CMAU2654176';

INSERT INTO contenedor_productos (contenedor_id, ref_code, nombre_producto, cantidad, peso_kg, valor_usd) 
SELECT id, '14031002', 'PISO SPC PREMIUM 42', 120, 2100.00, 3840.00 FROM contenedores WHERE numero_contenedor = 'CMAU2654176';

-- ============================================
-- VISTAS ÚTILES
-- ============================================

-- Vista de resumen de contenedores
CREATE VIEW v_contenedores_resumen AS
SELECT 
  c.id,
  c.nombre,
  c.numero_contenedor,
  c.destino,
  c.estado,
  c.eta,
  c.progreso,
  COUNT(cp.id) as total_productos,
  SUM(cp.cantidad) as total_items,
  SUM(cp.peso_kg) as peso_total_kg,
  SUM(cp.valor_usd) as valor_total_usd,
  c.created_at
FROM contenedores c
LEFT JOIN contenedor_productos cp ON c.id = cp.contenedor_id
GROUP BY c.id;

-- Vista de estadísticas generales
CREATE VIEW v_estadisticas AS
SELECT 
  COUNT(*) FILTER (WHERE estado = 'en_transito') as en_transito,
  COUNT(*) FILTER (WHERE estado = 'en_puerto') as en_puerto,
  COUNT(*) FILTER (WHERE estado = 'llegado') as llegados,
  COUNT(*) as total_contenedores,
  COUNT(DISTINCT cp.ref_code) as productos_unicos,
  SUM(cp.cantidad) as total_productos
FROM contenedores c
LEFT JOIN contenedor_productos cp ON c.id = cp.contenedor_id;

-- Vista de próximos arribes
CREATE VIEW v_proximos_arribes AS
SELECT 
  c.nombre,
  c.numero_contenedor,
  c.destino,
  c.eta,
  c.progreso,
  EXTRACT(DAY FROM (c.eta - CURRENT_DATE)) as dias_restantes
FROM contenedores c
WHERE c.estado != 'llegado' 
  AND c.eta IS NOT NULL
ORDER BY c.eta ASC;

-- ============================================
-- FUNCIONES ÚTILES
-- ============================================

-- Función para marcar contenedor como llegado
CREATE OR REPLACE FUNCTION marcar_llegado(contenedor_uuid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE contenedores 
  SET estado = 'llegado',
      progreso = 100,
      fecha_llegada_real = CURRENT_DATE
  WHERE id = contenedor_uuid;
END;
$$ LANGUAGE plpgsql;

-- Función para calcular días de retraso
CREATE OR REPLACE FUNCTION dias_retraso(contenedor_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  eta_fecha DATE;
  dias INTEGER;
BEGIN
  SELECT eta INTO eta_fecha FROM contenedores WHERE id = contenedor_uuid;
  
  IF eta_fecha IS NULL THEN
    RETURN NULL;
  END IF;
  
  dias := EXTRACT(DAY FROM (CURRENT_DATE - eta_fecha))::INTEGER;
  
  IF dias < 0 THEN
    RETURN 0;
  ELSE
    RETURN dias;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMENTARIOS
-- ============================================
COMMENT ON TABLE contenedores IS 'Registro de contenedores en tránsito';
COMMENT ON TABLE contenedor_productos IS 'Productos contenidos en cada contenedor';
COMMENT ON TABLE contenedor_historial IS 'Historial de cambios de estado';
COMMENT ON TABLE contenedor_documentos IS 'Documentos asociados (BL, facturas, etc)';
COMMENT ON COLUMN contenedores.progreso IS 'Progreso del envío (0-100)';
COMMENT ON COLUMN contenedores.estado IS 'Estado actual: en_transito, en_puerto, llegado';
