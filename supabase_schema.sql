-- =========================================================
-- JF 3D STUDIO - SUPABASE DATABASE SCHEMA
-- Copia y pega este script en el SQL Editor de tu proyecto en Supabase
-- =========================================================

-- 1. TABLA: INVENTARIO DE BOBINAS / FILAMENTOS
CREATE TABLE IF NOT EXISTS public.inventory (
    id TEXT PRIMARY KEY,
    brand TEXT NOT NULL,
    material TEXT NOT NULL,
    color TEXT NOT NULL,
    cost NUMERIC NOT NULL DEFAULT 12000,
    weight_grams NUMERIC NOT NULL DEFAULT 1000,
    remaining_grams NUMERIC NOT NULL DEFAULT 1000,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. TABLA: PEDIDOS DE CLIENTES
CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    products JSONB NOT NULL DEFAULT '[]'::jsonb,
    total_price NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'En Cola',
    payment TEXT NOT NULL DEFAULT 'Pendiente',
    date TEXT,
    filament_deducted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. TABLA: CATÁLOGO INTERNO (DISEÑOS Y DESGLOSE DE COSTOS)
CREATE TABLE IF NOT EXISTS public.internal_products (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    weight_grams NUMERIC NOT NULL DEFAULT 0,
    hours NUMERIC NOT NULL DEFAULT 0,
    spool_id TEXT,
    material_cost NUMERIC DEFAULT 0,
    error_margin_percent NUMERIC DEFAULT 10,
    error_margin_cost NUMERIC DEFAULT 0,
    electricity_rate NUMERIC DEFAULT 15,
    electricity_cost NUMERIC DEFAULT 0,
    depreciation_rate NUMERIC DEFAULT 25,
    depreciation_cost NUMERIC DEFAULT 0,
    net_cost NUMERIC DEFAULT 0,
    markup_percent NUMERIC DEFAULT 150,
    profit_cost NUMERIC DEFAULT 0,
    suggested_price NUMERIC DEFAULT 0,
    category TEXT DEFAULT 'Calculado',
    image_src TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 4. TABLA: CATÁLOGO DE VENTAS PÚBLICO / DIGITAL
CREATE TABLE IF NOT EXISTS public.public_products (
    id TEXT PRIMARY KEY,
    internal_prod_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    price TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    image_src TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 5. TABLA: CONFIGURACIÓN GENERAL Y COSTOS DEL SISTEMA
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- =========================================================
-- HABILITAR ROW LEVEL SECURITY (RLS) CON ACCESO ANÓNIMO
-- Permite que la app web lea y escriba directamente usando la Anon Public Key
-- =========================================================

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Políticas de acceso para Inventory
DROP POLICY IF EXISTS "Permitir lectura publica de inventario" ON public.inventory;
CREATE POLICY "Permitir lectura publica de inventario" ON public.inventory FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir insercion de inventario" ON public.inventory;
CREATE POLICY "Permitir insercion de inventario" ON public.inventory FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualizacion de inventario" ON public.inventory;
CREATE POLICY "Permitir actualizacion de inventario" ON public.inventory FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Permitir eliminacion de inventario" ON public.inventory;
CREATE POLICY "Permitir eliminacion de inventario" ON public.inventory FOR DELETE USING (true);

-- Políticas de acceso para Orders
DROP POLICY IF EXISTS "Permitir lectura publica de pedidos" ON public.orders;
CREATE POLICY "Permitir lectura publica de pedidos" ON public.orders FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir insercion de pedidos" ON public.orders;
CREATE POLICY "Permitir insercion de pedidos" ON public.orders FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualizacion de pedidos" ON public.orders;
CREATE POLICY "Permitir actualizacion de pedidos" ON public.orders FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Permitir eliminacion de pedidos" ON public.orders;
CREATE POLICY "Permitir eliminacion de pedidos" ON public.orders FOR DELETE USING (true);

-- Políticas de acceso para Internal Products
DROP POLICY IF EXISTS "Permitir lectura publica de catalogo interno" ON public.internal_products;
CREATE POLICY "Permitir lectura publica de catalogo interno" ON public.internal_products FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir insercion de catalogo interno" ON public.internal_products;
CREATE POLICY "Permitir insercion de catalogo interno" ON public.internal_products FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualizacion de catalogo interno" ON public.internal_products;
CREATE POLICY "Permitir actualizacion de catalogo interno" ON public.internal_products FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Permitir eliminacion de catalogo interno" ON public.internal_products;
CREATE POLICY "Permitir eliminacion de catalogo interno" ON public.internal_products FOR DELETE USING (true);

-- Políticas de acceso para Public Products
DROP POLICY IF EXISTS "Permitir lectura publica de catalogo digital" ON public.public_products;
CREATE POLICY "Permitir lectura publica de catalogo digital" ON public.public_products FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir insercion de catalogo digital" ON public.public_products;
CREATE POLICY "Permitir insercion de catalogo digital" ON public.public_products FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualizacion de catalogo digital" ON public.public_products;
CREATE POLICY "Permitir actualizacion de catalogo digital" ON public.public_products FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Permitir eliminacion de catalogo digital" ON public.public_products;
CREATE POLICY "Permitir eliminacion de catalogo digital" ON public.public_products FOR DELETE USING (true);

-- Políticas de acceso para Settings
DROP POLICY IF EXISTS "Permitir lectura publica de configuracion" ON public.app_settings;
CREATE POLICY "Permitir lectura publica de configuracion" ON public.app_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Permitir insercion de configuracion" ON public.app_settings;
CREATE POLICY "Permitir insercion de configuracion" ON public.app_settings FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualizacion de configuracion" ON public.app_settings;
CREATE POLICY "Permitir actualizacion de configuracion" ON public.app_settings FOR UPDATE USING (true);
