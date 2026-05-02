# Fint — Design Specification (Completo)

> Documento generado por análisis exhaustivo del frontend. Cubre identidad visual, sistema de diseño, modelo de dominio, arquitectura de pantallas, componentes, hooks, API y patrones de código.

---

## 1. App Overview

**Nombre**: Fint  
**Tipo**: Web + Mobile PWA — panel operativo y comercial B2B  
**Idioma**: Español (es-AR)  
**Usuarios objetivo**: Equipos de ventas, depósito, contabilidad y administración de PyMEs  
**Propósito**: Gestión centralizada de ventas, clientes, inventario, compras, proveedores, recetas de producción y análisis financiero  
**Stack**: React 18 + TypeScript + HeroUI + Tailwind CSS 4 + React Query + Zustand  
**Deploy**: PWA (Progressive Web App) — instalable en mobile y desktop  

---

## 2. Brand Identity

### Logo
- Ícono cuadrado con bordes redondeados (`border-radius: 12px`)
- Fondo degradado azul marino → azul profundo
- Logotipo SVG blanco centrado
- Tamaño en sidebar: 38×38px
- Nombre de la app junto al ícono: **"Fint"**, `font-weight: 700`, `font-size: 1.1rem`

### Tono Visual
- Glassmorphism corporativo moderno: fondos translúcidos + blur + superficies sólidas
- Color base azul corporativo con acentos teal/cyan
- UI densa y orientada a productividad — mucha información visible a la vez
- Data-first: tablas, listas y métricas son protagonistas, no ilustraciones
- Soporte completo para modo claro y oscuro

---

## 3. Color System

### Paleta principal — Light Mode

| Token | Hex | Uso |
|---|---|---|
| Primary | `#0D4FA9` | Botones, links, focus, estados activos |
| Primary foreground | `#FFFFFF` | Texto sobre fondo primary |
| Secondary | `#0F766E` | Acentos, highlights secundarios |
| Secondary foreground | `#FFFFFF` | Texto sobre fondo secondary |
| Background | `#F5F9FF` | Fondo de página |
| Foreground | `#0E1B32` | Texto principal |
| Content 1 | `#FFFFFF` | Superficie base (cards, inputs) |
| Content 2 | `#EEF4FF` | Superficie elevada leve |
| Content 3 | `#DFEAFB` | Superficie elevada media |
| Content 4 | `#CCDDF6` | Superficie elevada fuerte |
| Success | `#17C964` | Confirmaciones, entradas de stock |
| Danger | `#F31260` | Errores, eliminaciones, mermas |
| Warning | `#F5A623` | Alertas, pendientes |
| Divider | `rgba(69, 101, 149, 0.14)` | Bordes y separadores |

### Paleta principal — Dark Mode

| Token | Hex | Uso |
|---|---|---|
| Primary | `#5B95E6` | Botones, links, focus |
| Background | `#0C0F14` | Fondo de página |
| Foreground | `#EAF0FF` | Texto principal |
| Content 1 | `#131820` | Superficie base |
| Content 2 | `#1A202B` | Superficie elevada leve |
| Content 3 | `#232B38` | Superficie elevada media |
| Content 4 | `#2D3748` | Superficie elevada fuerte |
| Divider | `rgba(69, 101, 149, 0.20)` | Bordes y separadores |

### Colores semánticos de estado (badges)

| Estado | Background | Texto | Uso |
|---|---|---|---|
| Confirmada | `rgba(13,79,169,0.15)` | `#0D4FA9` | Orden confirmada |
| Pendiente | `rgba(120,120,120,0.25)` | gris-600 | Esperando acción |
| Cancelada | `rgba(243,18,96,0.15)` | `#F31260` | Operación cancelada |
| Pagado | `rgba(23,201,100,0.15)` | `#17C964` | Cobro completo |
| Parcial | `rgba(245,166,35,0.15)` | `#F5A623` | Cobro parcial |
| Entregada | `rgba(23,201,100,0.15)` | `#17C964` | Pedido entregado |
| Preparando | `rgba(13,79,169,0.15)` | `#0D4FA9` | En preparación |
| Recibida | `rgba(23,201,100,0.15)` | `#17C964` | Compra recibida |
| Borrador | `rgba(120,120,120,0.15)` | gris-500 | Compra en borrador |

### Degradados

- **Fondo de página**: dos radiales superpuestos — azul `rgb(13 79 169 / 0.12)` arriba, teal `rgb(15 118 110 / 0.08)` a la derecha, más un linear-gradient azul tenue, sobre `--heroui-background`
- **Card de acento financiero**: `linear-gradient(135deg, #0D4FA9 0%, #08305E 100%)` con radial overlay blanco al 5%
- **Sidebar glow (ítem activo)**: `box-shadow: inset 3px 0 0 #0D4FA9` + `background: rgba(13,79,169,0.08)`

---

## 4. Typography

### Fuente Principal
**IBM Plex Sans** — Google Fonts  
Fallbacks: `"Segoe UI", "SF Pro Text", "Helvetica Neue", sans-serif`

### Escala tipográfica

| Clase CSS | Tamaño | Peso | Letter-spacing | Uso |
|---|---|---|---|---|
| `.financial-page-title` | `clamp(2rem, 2.8vw, 3.1rem)` | 700 | -0.035em | Títulos del módulo financiero |
| `.page-title` | `clamp(1.35rem, 1.6vw, 1.6rem)` | 700 | -0.025em | Encabezado de cada página |
| Section Title | `1.25rem` | 700 | normal | Títulos dentro de secciones |
| Heading | `1rem–1.1rem` | 700 | normal | Subtítulos de cards |
| Body | `0.875rem` (14px) | 500 | normal | Texto principal de UI |
| `.page-subtitle` | `0.78rem` (12.5px) | 400 | normal | Subtítulos secundarios |
| `.section-kicker` | `11px` | 700 | 0.22em | Kicker uppercase teal |
| `.stat-card-label` | `10px` | 700 | 0.18em | Labels de stat cards |
| `.stat-card-value` | `clamp(1.4rem, 2.5vw, 2rem)` | 700 | -0.035em | Valor numérico grande |

### Kicker / Overline (`.section-kicker`)
```css
font-size: 11px;
font-weight: 700;
text-transform: uppercase;
letter-spacing: 0.22em;
color: secondary; /* cyan en dark mode */
```

---

## 5. Espaciado y Grid

### Base: `4px`

| Token | Valor | Uso |
|---|---|---|
| xs | 4px | Gaps internos de badges |
| sm | 8px | Gaps pequeños entre elementos |
| md | 12–16px | Padding de filas, gap entre cards |
| lg | 20–24px | Padding de cards y paneles |
| xl | 32–40px | Padding horizontal de página |
| 2xl | 48–64px | Espaciado entre secciones |

### Layout Desktop

```
┌────────────────────────────────────────────────────┐
│  Sidebar (256px fijo)  │   Content (flexible)       │
│                        │                            │
│  [Logo + "Fint"]       │  [Page header sticky]      │
│  ─────────────────     │  ──────────────────────    │
│  Nav items             │  [Content area / outlet]   │
│  (icon + label)        │                            │
│  ─────────────────     │                            │
│  [User avatar + role]  │                            │
└────────────────────────────────────────────────────┘
```

### Layout Mobile

```
┌─────────────────────────┐
│  [Topbar sticky 56px]   │  ← backdrop-blur(12px)
│  ─────────────────────  │
│                         │
│  [Content / outlet]     │  ← scroll libre
│                         │
│  ─────────────────────  │
│  [Bottom nav 56px+]     │  ← fixed, safe-area-inset-bottom
└─────────────────────────┘
```

### Breakpoints

| Nombre | Valor | Comportamiento |
|---|---|---|
| sm | 640px | Layout 2 columnas en listas |
| md | 768px | Tablas completas, menos truncados |
| lg | 1024px | Sidebar visible, layout desktop completo |
| xl | 1280px | Paneles más amplios, más columnas |

---

## 6. Componentes de UI

### 6.1 Sidebar (Desktop, 256px)

- Fondo: `Content 1` con `backdrop-filter: blur(12px)`
- Borde derecho: `1px solid Divider`
- **Logo + nombre** en la parte superior (padding 16px)
- Lista de ítems de navegación con ícono (20px) + etiqueta
- Ítem activo: fondo `rgba(primary, 0.08)`, borde izquierdo `3px solid Primary`, texto `Primary`
- Hover: fondo `rgba(primary, 0.05)`
- Sección inferior fija: avatar del usuario + nombre + rol
- Scrollbar personalizado (2px de ancho, color primary/30)
- Secciones de navegación con kicker/etiqueta separadora

**Grupos de navegación en sidebar**:
1. **Operación**: Dashboard, Nueva Venta, Ventas, Clientes, Productos, Movimientos
2. **Producción**: Insumos, Compras, Proveedores, Recetas
3. **Cuentas Corrientes**: Cuenta Clientes, Cuenta Proveedores
4. **Centro Financiero**: Panel Financiero
5. **Administración**: Equipo, Ajustes

### 6.2 Bottom Navigation Bar (Mobile)

- Fondo: `Content 1` con `backdrop-filter: blur(18px)`
- Borde superior: `1px solid Divider`
- 5–6 tabs con ícono (22px) + etiqueta (10px, uppercase, 700)
- Tab activo: ícono y texto en `Primary`
- Tab inactivo: color `default-400`
- `padding-bottom: env(safe-area-inset-bottom)` para notch
- Altura mínima: 56px
- Oculto en `/new-operation` y en rutas `/financial/*`

**Tabs del bottom bar**:
1. Inicio (LayoutGrid) — con badge de notificaciones no leídas
2. Ventas (ShoppingCart)
3. Nueva venta (Plus) — botón central elevado
4. Clientes (Users)
5. Más (Menu) — despliega el resto de secciones

### 6.3 Page Header

- Sticky en la parte superior del content (no del sidebar)
- Altura: ~56px
- Fondo: `rgba(Background, 0.85)` + `backdrop-filter: blur(12px)`
- Borde inferior: `1px solid Divider`
- Contenido: **Título de página** (izquierda) + **acciones** (derecha)
- Mobile: puede tener ícono de notificaciones y/o botón de acción principal

### 6.4 Cards — `.app-panel`

```css
background: rgba(Content1, 0.9);
border: 1px solid Divider;
border-radius: 16–20px;
padding: 20–24px;
box-shadow: 0 12px 28px rgba(13,79,169,0.07);
backdrop-filter: blur(8px);
```

Hover:
```css
box-shadow: 0 8px 28px rgba(13,79,169,0.10);
transform: translateY(-1px);
transition: all 0.15s ease;
```

Variante `.app-panel-soft`: `opacity: 0.7`, fondo más transparente

### 6.5 Stat Cards (KPI) — `.stat-card`

```css
border-radius: 20px;
border: 1px solid Divider;
padding: 20px;
background: Content1;
```

Estructura interna:
```
[Kicker label — 10px uppercase]
[Valor numérico grande — clamp(1.4rem, 2.5vw, 2rem)]
[Subtítulo secundario]
[Variación % con ícono de flecha]
```

Variante financiera (`.financial-card-accent`): fondo degradado azul oscuro, texto blanco

### 6.6 Filas de Lista — `.list-row`

```css
display: flex;
align-items: center;
gap: 12px;
padding: 12px 16px;
border-radius: 14px;
border: 1px solid Divider;
background: transparent;
cursor: pointer;
transition: all 0.15s ease;
```

Hover:
```css
background: rgba(primary, 0.04);
border-color: rgba(primary, 0.15);
```

Estructura interna estándar:
```
[Avatar/Ícono 40px] [Info column flex-1] [Badge/Monto] [Chevron 16px]
```

### 6.7 Botones

| Variante | Estilo |
|---|---|
| Primary (solid) | `bg-primary`, `text-white`, `border-radius: 12px`, `font-weight: 700`, `height: 40–44px` |
| Flat | `bg-primary/10`, `text-primary`, sin borde, `border-radius: 12px` |
| Ghost | Solo borde `border-primary/40`, `text-primary`, fondo transparente |
| Danger solid | `bg-danger`, `text-white` |
| Danger flat | `bg-danger/10`, `text-danger` |
| Icon button | Cuadrado 36–40px, `border-radius: 10px`, variante flat o ghost |

Efectos:
- Hover: `translateY(-1px)` + sombra leve
- Active: `scale(0.98)`
- Disabled: `opacity: 0.5`
- Cargando: spinner reemplaza texto, ancho fijo para evitar layout shift

### 6.8 Inputs — `.corp-input`

```css
border-radius: 14px;
border: 1.5px solid Divider;
background: rgba(Content1, 0.6);
padding: 10px 14px;
font-size: 14px;
font-weight: 500;
height: 44px;
transition: border-color 0.15s ease;
```

Focus:
```css
border-color: rgba(primary, 0.5);
background: rgba(Content1, 0.9);
box-shadow: 0 0 0 3px rgba(primary, 0.08);
```

Label: `font-size: 12px`, `font-weight: 600`, `color: Foreground/70`, `margin-bottom: 4px`

### 6.9 Search Bar — `.search-bar`

```css
display: flex;
align-items: center;
gap: 8px;
border-radius: 14px;
border: 1px solid Divider;
padding: 8px 14px;
background: Content1;
```

- Ícono de lupa (16px, color default-400) a la izquierda
- Input sin borde propio, hereda el del contenedor
- Placeholder: `"Buscar..."` en default-400

### 6.10 Badges / Chips

```css
display: inline-flex;
align-items: center;
padding: 3px 10px;
border-radius: 999px;
font-size: 11px;
font-weight: 700;
gap: 4px;
```

Colores según tabla de estados (sección 3).

### 6.11 Modal / Drawer — Desktop

```css
border-radius: 20px;
padding: 28px;
background: Content1;
box-shadow: 0 24px 56px rgba(10,22,44,0.24);
max-width: 480–560px;
```

Variante slide-over (panel lateral):
- Ancho: 420–480px
- Altura: 100dvh
- Slide desde la derecha
- Overlay semitransparente a la izquierda

### 6.12 Bottom Sheet — Mobile

```css
border-radius: 20px 20px 0 0;
padding: 24px 20px;
padding-bottom: calc(24px + env(safe-area-inset-bottom));
background: Content1;
backdrop-filter: blur(18px);
width: 100%;
```

Handle bar:
```css
width: 40px;
height: 4px;
border-radius: 999px;
background: Divider;
margin: 0 auto 16px auto;
```

### 6.13 Tabla de Datos

- Encabezados: `font-size: 11px`, `font-weight: 700`, `text-transform: uppercase`, `letter-spacing: 0.08em`, `color: default-500`
- Filas: `border-bottom: 1px solid Divider`, `height: 52px`, `padding: 0 16px`
- Fila hover: fondo `rgba(primary, 0.03)`
- Celdas: `font-size: 14px`, `font-weight: 500`

### 6.14 Paginación — `PaginationBar`

- Componente custom en `/src/components/PaginationBar.tsx`
- Muestra: `"1–15 de 300"`
- Botones Anterior / Siguiente
- Props: `currentPage`, `totalPages`, `from`, `to`, `loading`
- Mobile: lista con infinite scroll en lugar de paginación

### 6.15 Avatar

- Círculo con iniciales: `border-radius: 999px`
- Tamaños: 32px (tabla), 40px (lista), 48px (perfil)
- Fondo: `bg-primary/15`, texto `text-primary`, `font-weight: 700`
- Si hay foto: imagen circular

### 6.16 Toast / Notificación — `AppToast`

- Componente: `/src/components/AppToast.tsx`
- Hook: `useAppToast()`
- Variantes: `success`, `error`, `info`, `warning`
- Posición: top-center fixo
- Auto-dismiss: configurable (default ~4s)
- Botón de cierre manual
- Animación: slide-in desde arriba

### 6.17 Notificaciones (panel slide-over)

- Panel derecho que aparece sobre el contenido
- Disparado desde ícono de campana en sidebar/topbar
- Badge rojo con contador de no leídas
- Acciones: marcar como leída, eliminar
- Lista de notificaciones del backend (`/notifications`)

### 6.18 FinancialFilterBar

- Componente: `/src/components/financial/FinancialFilterBar.tsx`
- Date range picker (desde / hasta)
- Multi-select de categorías
- Botón "Resetear filtros"
- Props: `categories[]`, `filters`, `onChange`

---

## 7. Modelo de Dominio

### 7.1 Client (Cliente)

```typescript
{
  _id: string;
  name: string;
  phone: string;
  taxId?: string;           // CUIT / NIT / RUC
  debt?: number;
  email?: string;
  address?: string;
  fiscalAddress?: string;
  company?: string;
  notes?: string;
  isActive?: boolean;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
```

### 7.2 Supplier (Proveedor)

```typescript
{
  _id: string;
  name: string;
  company?: string;
  taxId?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive?: boolean;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
```

### 7.3 Product (Producto)

```typescript
{
  _id: string;
  sku?: string;
  name: string;
  description?: string;
  price: number;
  costPrice?: number;
  stock: number;
  minStock?: number;
  category?: string;
  categories?: string[];        // Sistema de categorías múltiples
  unitOfMeasure?: string;       // unidad | kg | g | litro | ml | metro | caja | paquete
  isActive?: boolean;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
```

### 7.4 Supply (Insumo / Materia Prima)

```typescript
{
  _id: string;
  sku?: string | null;
  name: string;
  unit: SupplyUnit;             // unidad | kg | g | litro | ml | metro | caja | paquete
  currentStock: number;
  minStock: number;
  referenceCost: number;
  isActive: boolean;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
```

### 7.5 SupplyMovement (Movimiento de Insumo)

```typescript
{
  _id: string;
  supply: Supply | string;
  type: SupplyMovementType;     // IN | OUT | ADJUST
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  sourceType: string;
  sourceId?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}
```

### 7.6 StockMovement (Movimiento de Producto)

```typescript
{
  _id: string;
  product: Product | string;
  type: MovementType;           // ENTRADA | SALIDA | MERMA | AJUSTE
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reason: string;
  source: string;
  createdAt?: string;
}
```

### 7.7 Order (Venta / Pedido)

```typescript
{
  _id: string;
  orderNumber: string;
  client: Client | string;
  date: string;
  salesStatus: SalesStatus;    // Pendiente | Confirmada | Cancelada
  paymentStatus: PaymentStatus;// Pendiente | Parcial | Pagado
  deliveryStatus: DeliveryStatus;// Pendiente | Preparando | Entregada
  paymentMethod?: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

type OrderItem = {
  product: Product | string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};
```

### 7.8 Purchase (Orden de Compra)

```typescript
{
  _id: string;
  supplier: Supplier | string;
  date: string;
  status: PurchaseStatus;       // DRAFT | CONFIRMED | RECEIVED | CANCELLED
  paymentCondition: PaymentCondition; // CASH | CREDIT
  subtotal: number;
  tax: number;
  total: number;
  notes: string;
  items: PurchaseItem[];
  receivedAt?: string | null;
  cancelledAt?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

type PurchaseItem = {
  supply: Supply | string;
  quantity: number;
  unitCost: number;
  subtotal: number;
};
```

### 7.9 Recipe (Receta de Producción)

```typescript
{
  _id: string;
  name: string;
  product?: Product | string | null;
  yieldQuantity: number;        // Unidades producidas por batch
  ingredients: RecipeIngredient[];
  notes?: string;
  isActive: boolean;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

type RecipeIngredient = {
  supply: Supply | string;
  quantity: number;
};
```

### 7.10 TeamMember (Usuario del Sistema)

```typescript
{
  _id: string;
  fullName: string;
  email: string;
  role: UserRole;               // admin | ventas | deposito | contabilidad | lectura
  roleLabel: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}
```

### 7.11 ClientAccountEntry / SupplierAccountEntry (Cuenta Corriente)

```typescript
{
  _id: string;
  client?: Client | string;     // o supplier
  type: EntryType;              // CHARGE | PAYMENT | CREDIT_NOTE | DEBIT_NOTE
  amount: number;
  sign: 1 | -1;
  paymentMethod?: string;
  orderId?: string | null;
  purchaseId?: string | null;
  notes?: string;
  createdAt?: string;
}
```

---

## 8. Arquitectura de Rutas

### 8.1 Estructura de rutas (App.tsx)

```
/login                          ← Público (solo si no autenticado)
/                               ← ProtectedLayout → MobileLayout
  /                             → Dashboard
  /products                     → Products
  /products/:productId          → Products (detalle)
  /clients                      → Clients
  /clients/:clientId            → Clients (detalle)
  /sales                        → Sales
  /sales/:orderId               → Sales (detalle)
  /movements                    → Movements
  /movements/:movementId        → Movements (detalle)
  /new-operation                → NewOperation (sin bottom nav)
  /supplies                     → Supplies
  /supplies/:supplyId           → Supplies (detalle)
  /purchases                    → Purchases
  /purchases/:purchaseId        → Purchases (detalle)
  /supplier-account             → SupplierAccount
  /recipes                      → Recipes
  /suppliers                    → Suppliers
  /team                         → Team
  /client-account               → ClientAccount
  /settings                     → Settings
  /financial                    → FinancialLayout (layout diferente)
    /financial/dashboard        → FinancialDashboard
    /financial/accounting       → AccountingStatements
    /financial/product-analysis → ProductAnalysis
    /financial/projections      → SpeculationsProjections
    /financial/purchases        → PurchasesDashboard
*                               → NotFound
```

### 8.2 Sistema de Layouts

| Layout | Ruta | Características |
|---|---|---|
| `ProtectedLayout` | Todas las rutas | Redirige a `/login` si no autenticado |
| `MobileLayout` | Rutas principales | Sidebar desktop + bottom nav mobile + notificaciones |
| `FinancialLayout` | `/financial/*` | Navegación financiera propia, sin bottom bar |
| `DefaultLayout` | Sin uso principal | Navbar + main + footer (páginas marketing) |

### 8.3 Lazy Loading

Todas las páginas usan `React.lazy()` con `Suspense` y un fallback spinner para optimizar el bundle inicial.

---

## 9. Pantallas — Descripción Detallada

### 9.1 Login (`/login`)

**Propósito**: Autenticación del usuario  
**Acceso**: Solo usuarios no autenticados  
**Layout**: Sin sidebar ni nav. Fondo con degradado radial azul.

**Contenido**:
- Card centrada (max-width: 400px) con `.app-panel`
- Logo Fint en la parte superior de la card
- Título "Iniciar sesión"
- Campo Email (Input, type email)
- Campo Contraseña (Input, type password, con toggle show/hide)
- Botón primary full-width "Entrar" con estado loading
- Mensaje de error si falla la autenticación

**API**: `POST /auth/login` → `{ token, user }`  
**Post-login**: Redirige a `/` (Dashboard)

---

### 9.2 Dashboard (`/`)

**Propósito**: Vista ejecutiva con métricas clave de operación y finanzas  
**Usuarios**: Todos los roles  

**Secciones**:

**Panel Superior — Acciones rápidas**
- Botones de acceso directo: Nueva Venta, Agregar Cliente, Agregar Producto, Configuración, Finanzas

**KPIs Principales (stat cards)**
- Cobrado del mes
- Stock bajo
- Órdenes pendientes
- Clientes con deuda

**Resumen operativo**
- Órdenes confirmadas / pagadas / entregadas (contadores)

**Actividad reciente**
- Feed de últimas órdenes y movimientos de stock
- Cada fila: tipo de evento + descripción + monto/cantidad + timestamp

**Top Productos**
- Lista de productos con mayor revenue del período
- Nombre + unidades vendidas + ingreso total

**Alertas de Stock bajo**
- Productos con stock ≤ minStock
- Nombre + stock actual vs. mínimo + badge de alerta

**KPIs Opcionales** (configurable, con rango de fechas)
- Ganancia Bruta
- Margen Bruto %
- Crecimiento vs. período anterior
- Clientes nuevos vs. recurrentes
- Por categoría de producto
- Exportar como CSV o PDF

**API**:
- `GET /dashboard` — resumen general
- `GET /dashboard/optional-kpis` — métricas opcionales con filtro de fecha

---

### 9.3 Productos (`/products`, `/products/:productId`)

**Propósito**: Gestión del catálogo de productos para venta  
**Usuarios**: admin, ventas, depósito  

**Lista (mobile: scroll infinito / desktop: paginada)**
- Búsqueda por nombre o SKU
- Filtro por categoría
- Filtro "Stock bajo"
- Cada fila: SKU (small) + nombre + precio + stock + badge de estado de stock

**Detalle de producto** (slide-over desktop / pantalla completa mobile)
- Precio de venta y costo (si se puede ver)
- Margen %
- Stock actual vs. mínimo
- SKU + categorías (chips)
- Historial de movimientos (últimos N)
- Botones: Editar, Eliminar (soft delete)

**Formulario Crear/Editar** (modal/drawer)
- SKU con auto-sugerencia basada en categoría + nombre
- Nombre (requerido)
- Descripción
- Categorías (sistema de tags: agregar/quitar)
- Precio de venta (requerido)
- Precio de costo → muestra sugerencias de precio basadas en margen (30%, 40%, 50%)
- Stock actual
- Stock mínimo
- Unidad de medida (select: unidad, kg, g, litro, ml, metro, caja, paquete)
- Toggle activo/inactivo

**API**:
- `GET /products` — lista con paginación/infinite
- `GET /products/:id` — detalle
- `POST /products` — crear
- `PUT /products/:id` — actualizar
- `DELETE /products/:id` — soft delete

---

### 9.4 Clientes (`/clients`, `/clients/:clientId`)

**Propósito**: CRUD de clientes con seguimiento de cuenta corriente  
**Usuarios**: admin, ventas  

**Lista** (infinite scroll)
- Búsqueda por nombre o teléfono
- Cada fila: avatar con iniciales + nombre + empresa (si aplica) + saldo de deuda + badge estado

**Detalle** (slide-over desktop / pantalla completa mobile)
- Avatar grande con iniciales
- Nombre + empresa
- CUIT/NIT, email, teléfono, dirección
- Notas
- Botones: Editar, Eliminar, Nueva Venta

**Formulario Crear/Editar**
- Nombre (requerido)
- Empresa
- Teléfono (requerido)
- CUIT / NIT / RUC
- Email
- Dirección
- Dirección fiscal
- Deuda inicial
- Notas

**API**:
- `GET /clients` — lista
- `GET /clients/:id` — detalle
- `POST /clients` — crear
- `PUT /clients/:id` — actualizar
- `DELETE /clients/:id` — soft delete

---

### 9.5 Ventas (`/sales`, `/sales/:orderId`)

**Propósito**: Ver y gestionar órdenes de venta  
**Usuarios**: admin, ventas  

**Lista** (paginada + filtros)
- Filtros: estado de venta (Pendiente/Confirmada/Cancelada), estado de pago (Pendiente/Parcial/Pagado), estado de entrega (Pendiente/Preparando/Entregada)
- Búsqueda por número de orden, cliente, fecha
- Cada fila: N° orden + cliente + fecha + total + badges de estado (venta, pago, entrega)

**Detalle de Orden** (slide-over desktop / pantalla completa mobile)
- Info del cliente (nombre, teléfono)
- Número de orden + fecha
- Items (producto, cantidad, precio unitario, subtotal)
- Subtotal, impuestos, total
- Método de pago
- Notas
- Botones de cambio de estado:
  - Estado de venta (dropdown)
  - Estado de pago (dropdown)
  - Estado de entrega (dropdown)
- Botón "Descargar Factura" (genera PDF)
- Historial de movimientos de stock asociados

**API**:
- `GET /orders` — lista con filtros
- `GET /orders/:id` — detalle (incluye movimientos)
- `PUT /orders/:id` — actualizar estados y notas
- `GET /orders/:id/invoice` — PDF de factura

---

### 9.6 Nueva Operación (`/new-operation`)

**Propósito**: Flujo de creación de orden de venta  
**Usuarios**: admin, ventas  
**Layout especial**: Sin bottom navigation bar  

**Flujo**:
1. Buscar y seleccionar cliente (autocomplete, búsqueda por nombre/teléfono)
2. Buscar y agregar productos al carrito (autocomplete, búsqueda por nombre/SKU)
3. Para cada producto: ajustar cantidad (valida contra stock disponible)
4. Ver resumen: subtotal, impuesto (según config), total
5. Agregar notas opcionales
6. "Crear Venta" → `POST /orders`

**Validaciones**:
- Stock disponible por producto
- Al menos un producto en el carrito
- Cliente seleccionado

**API**: `POST /orders` con items[]

---

### 9.7 Movimientos de Stock (`/movements`, `/movements/:movementId`)

**Propósito**: Historial y creación manual de movimientos de inventario de productos  
**Usuarios**: admin, depósito  

**Lista** (paginada + filtros)
- Filtro por producto
- Filtro por tipo: ENTRADA, SALIDA, MERMA, AJUSTE
- Filtro por fuente (manual, sistema, orden, etc.)
- Filtro por fecha (preset o rango)
- Cada fila: producto + tipo (con badge color) + cantidad + stock resultante + motivo + fecha

**Formulario nuevo movimiento**
- Producto (autocomplete)
- Tipo de movimiento (select)
- Cantidad
- Motivo
- Fuente

**API**:
- `GET /stock-movements` — lista con filtros
- `GET /stock-movements/:id` — detalle
- `POST /stock-movements` — crear movimiento manual

---

### 9.8 Insumos (`/supplies`, `/supplies/:supplyId`)

**Propósito**: Gestión de materias primas e ingredientes  
**Usuarios**: admin, depósito  

**Lista** (infinite scroll o paginada)
- Búsqueda por nombre
- Cada fila: nombre + unidad + stock actual vs. mínimo + costo referencial + badge de estado de stock

**Detalle** (slide-over / pantalla completa)
- Nombre + unidad
- Stock actual vs. mínimo (con alerta si está bajo)
- Costo referencial
- SKU (si tiene)
- Historial de movimientos del insumo
- Botones: Editar, Eliminar

**Formulario Crear/Editar**
- SKU (opcional)
- Nombre (requerido)
- Unidad de medida (select)
- Stock actual
- Stock mínimo
- Costo de referencia

**Formulario de Movimiento de Insumo** (dentro del detalle)
- Tipo: IN, OUT, ADJUST
- Cantidad
- Motivo

**API**:
- `GET /supplies` — lista
- `GET /supplies/:id` — detalle
- `POST /supplies` — crear
- `PUT /supplies/:id` — actualizar
- `DELETE /supplies/:id` — soft delete
- `GET /supply-movements` — historial

---

### 9.9 Compras (`/purchases`, `/purchases/:purchaseId`)

**Propósito**: Gestión de órdenes de compra a proveedores  
**Usuarios**: admin, depósito  

**Lista** (paginada + filtros)
- Filtro por estado: DRAFT, CONFIRMED, RECEIVED, CANCELLED
- Cada fila: proveedor + fecha + total + estado (badge) + condición de pago

**Detalle** (slide-over / pantalla completa)
- Proveedor
- Fecha, condición de pago
- Items (insumo, cantidad, costo unitario, subtotal)
- Subtotal + impuesto + total
- Notas
- Estado con workflow:
  - DRAFT → "Confirmar" → CONFIRMED
  - CONFIRMED → "Marcar Recibida" → RECEIVED
  - Cualquier estado activo → "Cancelar"
- Timestamps: confirmado, recibido, cancelado

**Formulario Crear/Editar**
- Proveedor (autocomplete)
- Fecha
- Condición de pago (CASH / CREDIT)
- Líneas de ítems (insumo + cantidad + costo unitario, calculado = subtotal)
- Impuesto %
- Notas

**API**:
- `GET /purchases` — lista
- `GET /purchases/:id` — detalle
- `POST /purchases` — crear (DRAFT por defecto)
- `PUT /purchases/:id` — actualizar / cambiar estado
- `DELETE /purchases/:id` — cancelar

---

### 9.10 Recetas (`/recipes`)

**Propósito**: Definir recetas de producción y ejecutar batches  
**Usuarios**: admin, depósito  

**Lista** (paginada)
- Nombre + producto resultante + rendimiento por batch
- Botón "Producir" por fila

**Detalle / Modal de receta**
- Nombre
- Producto resultante (referencia a catálogo de productos)
- Rendimiento (unidades producidas por batch)
- Tabla de ingredientes (insumo + cantidad por batch)
- Notas

**Modal "Producir"**
- Cantidad de batches a ejecutar
- Muestra insumos requeridos totales vs. stock disponible
- Validación: ¿hay suficiente stock de cada insumo?
- Confirmación → descuenta insumos del inventario y agrega stock al producto

**Logs de producción**
- Historial de batches ejecutados (fecha, receta, cantidad producida, insumos descontados)

**API**:
- `GET /recipes` — lista
- `GET /recipes/:id` — detalle
- `POST /recipes` — crear
- `PUT /recipes/:id` — actualizar
- `POST /recipes/:id/produce` — ejecutar batch de producción
- `GET /production-logs` — historial de producción

---

### 9.11 Proveedores (`/suppliers`)

**Propósito**: CRUD de proveedores  
**Usuarios**: admin, depósito  

**Lista** (paginada o infinite)
- Búsqueda por nombre o empresa
- Cada fila: nombre + empresa + teléfono + email

**Formulario Crear/Editar**
- Nombre
- Empresa
- CUIT / NIT / RUC
- Teléfono
- Email
- Dirección
- Notas

**API**:
- `GET /suppliers`, `POST /suppliers`, `PUT /suppliers/:id`, `DELETE /suppliers/:id`

---

### 9.12 Cuenta Corriente Clientes (`/client-account`)

**Propósito**: Libro mayor de cuentas por cobrar  
**Usuarios**: admin, contabilidad  

**Panel principal**
- Selector de cliente
- Saldo actual destacado (positivo = debe, negativo = a favor)
- Lista de entradas: fecha + tipo + monto + referencia a orden + método de pago
- Tipos: CHARGE (cargo), PAYMENT (pago), CREDIT_NOTE, DEBIT_NOTE

**API**:
- `GET /client-accounts` — resumen de todas las cuentas
- `GET /client-accounts/:clientId/entries` — entradas del libro

---

### 9.13 Cuenta Corriente Proveedores (`/supplier-account`)

**Propósito**: Libro mayor de cuentas por pagar  
**Usuarios**: admin, contabilidad  

Estructura idéntica a Cuenta Clientes pero referenciando proveedores y órdenes de compra.

**API**:
- `GET /supplier-accounts`
- `GET /supplier-accounts/:supplierId/entries`

---

### 9.14 Equipo (`/team`)

**Propósito**: Gestión de usuarios del sistema  
**Acceso**: Solo rol `admin` (controlado por `usePermissions`)  

**Lista**
- Avatar + nombre completo + email
- Badge de rol (color según rol)
- Estado activo/inactivo (toggle)
- Última vez que inició sesión
- Botón Editar

**Formulario Crear/Editar**
- Nombre completo
- Email
- Contraseña (solo en creación)
- Rol (select): admin / ventas / deposito / contabilidad / lectura
- Toggle activo/inactivo

**Roles y sus etiquetas**:
| Rol | Label | Acceso |
|---|---|---|
| admin | Administrador | Todo |
| ventas | Ventas | Órdenes, clientes, productos |
| deposito | Depósito | Inventario, compras, movimientos |
| contabilidad | Contabilidad | Finanzas, cuentas corrientes |
| lectura | Solo lectura | Vista sin modificaciones |

**API**:
- `GET /team`, `POST /team`, `PUT /team/:id`, `DELETE /team/:id`

---

### 9.15 Ajustes (`/settings`)

**Propósito**: Configuración global de la app  
**Acceso**: admin  

**Secciones / Tabs**:

**1. Empresa**
- Nombre del negocio
- CUIT / NIT
- Condición fiscal
- Dirección
- Teléfono
- Email

**2. Ventas**
- Tasa de impuesto (%)
- Moneda (USD, ARS, MXN, COP, EUR)
- Prefijo de órdenes (ej. "ORD-")
- Estado por defecto para ventas / pago / entrega al crear una orden

**3. Inventario**
- Umbral de stock bajo
- Unidad de medida por defecto
- Momento de deducción de stock (al confirmar / al entregar)

**4. Apariencia**
- Selector de tema: Light / Dark / Sistema

**5. Integraciones**
- WhatsApp: número admin, números autorizados, formato (AR / INTL)
- Estado del servicio WhatsApp: Conectado / Desconectado / Esperando QR
- Botones: Iniciar / Detener / Reiniciar
- QR code (cuando status = qr_ready)

**API**:
- `GET /settings` — obtener configuración
- `PUT /settings` — guardar cambios
- `POST /whatsapp/start`, `/whatsapp/stop`, `/whatsapp/restart`

---

### 9.16 Dashboard Financiero (`/financial/dashboard`)

**Layout**: `FinancialLayout` con sidebar financiero propio (244px)  
**Acceso**: admin, contabilidad (controlado por `usePermissions`)  

**Sidebar financiero** (244px, sticky):
- Logo pequeño + botón "← Volver al panel"
- Ítems: Panel, Contabilidad, Análisis de Productos, Proyecciones, Compras
- Ítem activo: fondo azul sólido, texto blanco, `border-radius: 10px`

**Contenido del Dashboard Financiero**:
- Filtro superior: período (mes, trimestre, año, custom) + categorías
- Card de acento (degradado azul oscuro) con: Revenue total, Ganancia Bruta, Margen Neto, Crecimiento %
- Grid de KPI cards: 3–4 métricas secundarias
- Gráfico de líneas/barras: ingresos mensuales (12 meses)
- Breakdown por categoría (tabla o donut chart)
- Transacciones recientes
- Alertas e insights del sistema

**API**:
- `GET /financial/overview?from=&to=&categories=`
- `GET /financial/categories`

---

### 9.17 Contabilidad (`/financial/accounting`)

**Propósito**: Estados contables (P&L, Balance, Cash Flow)  
**Layout**: `FinancialLayout`  

**Estados disponibles**:
- Estado de Resultados: Revenue, COGS, Ganancia Bruta, Gastos Operativos, Resultado Neto
- Balance General
- Flujo de Caja
- Comparación entre períodos

**API**: `GET /financial/accounting`

---

### 9.18 Análisis de Productos (`/financial/product-analysis`)

**Propósito**: Rentabilidad por producto  
**Layout**: `FinancialLayout`  

**Contenido**:
- Tabla de productos con: ventas, costo, margen, % del total
- Clasificación ABC
- Ranking de performance
- Exportación a PDF/CSV

**API**: `GET /financial/product-analysis`

---

### 9.19 Proyecciones (`/financial/projections`)

**Propósito**: Forecasting de ventas e ingresos  
**Layout**: `FinancialLayout`  

**Contenido**:
- Análisis de tendencia histórica
- Proyección para próximos meses
- Ajustes estacionales
- Escenarios comparativos

**API**: `GET /financial/projections`

---

### 9.20 Análisis de Compras (`/financial/purchases`)

**Propósito**: Costo de compras y performance de proveedores  
**Layout**: `FinancialLayout`  

**Contenido**:
- Volumen de compras por proveedor
- Tendencia de costos
- Comparativa de proveedores
- Performance de pagos

**API**: `GET /financial/purchases-dashboard`

---

## 10. Custom Hooks

### 10.1 Autenticación

**`useAuth`** — `/src/hooks/useAuth.tsx`
- Context provider de autenticación
- Expone: `user`, `token`, `loading`, `isAuthenticated`
- Métodos: `login(email, password)`, `logout()`
- Valida token en mount con `GET /auth/me`
- Auto-logout en 401 via interceptor de Axios
- Sincronización entre tabs via `localStorage` events

### 10.2 Permisos

**`usePermissions`** — `/src/hooks/usePermissions.ts`
- Basado en el rol del usuario autenticado
- Expone: `can.manageTeam`, `can.viewFinancial`, `can.createOrders`, etc.
- Expone: `roleLabel` (nombre legible del rol)
- Usado para renderizado condicional de secciones

### 10.3 Datos de Productos

| Hook | Descripción |
|---|---|
| `useProducts` | Lista con paginación, CRUD mutations |
| `useInfiniteProducts` | Infinite scroll, por páginas |
| `useProductDetail` | Producto individual por ID |

### 10.4 Datos de Clientes

| Hook | Descripción |
|---|---|
| `useClients` | Lista + CRUD |
| `useInfiniteClients` | Infinite scroll |
| `useClientDetail` | Cliente individual |

### 10.5 Datos de Órdenes

| Hook | Descripción |
|---|---|
| `useOrders` | Lista con filtros |
| `useInfiniteOrders` | Infinite scroll |
| `useOrderDetail` | Orden individual + movimientos asociados |

### 10.6 Inventario y Producción

| Hook | Descripción |
|---|---|
| `useSupplies` | CRUD de insumos |
| `useSupplyMovements` | Movimientos de insumos |
| `usePurchases` | CRUD de órdenes de compra |
| `usePurchaseDetail` | Compra individual |
| `useSuppliers` | CRUD de proveedores |
| `useRecipes` | CRUD de recetas + producción |
| `useStockMovements` | Movimientos de productos |

### 10.7 Finanzas y Administración

| Hook | Descripción |
|---|---|
| `useDashboard` | Métricas del dashboard |
| `useDashboardOptionalKpis` | KPIs opcionales con rango de fecha |
| `useFinancial` | Dashboard financiero |
| `useFinancialOverview` | Datos financieros con filtros |
| `useFinancialFilters` | Estado de filtros (fecha, categorías) |
| `useClientAccount` | Cuentas por cobrar |
| `useSupplierAccount` | Cuentas por pagar |
| `useTeam` | Usuarios del sistema |
| `useSettings` | Configuración global |
| `usePermissions` | RBAC en frontend |

### 10.8 Utilidades de UI

| Hook | Descripción |
|---|---|
| `useIsDesktop` | `true` si `min-width: 1024px` |
| `useMobileHeaderCompact` | Header compacto en scroll |
| `useNotifications` | Feed de notificaciones, marcar leídas |
| `useWhatsApp` | Estado + control del servicio WhatsApp |
| `useAppToast` | Mostrar toasts programáticos |

---

## 11. Gestión de Estado

### 11.1 Zustand — Estado Local Persistido

**`themeStore`** — `/src/stores/themeStore.ts`
```typescript
{
  theme: "light" | "dark";
  setTheme: (theme) => void;
  toggleTheme: () => void;
}
```
- Persistido en `localStorage` via middleware `persist`
- Sincronizado con `next-themes`

### 11.2 React Query — Estado del Servidor

- **QueryClient** centralizado en `main.tsx`
- **Query Keys** jerárquicas: `["products"]`, `["product", id]`, `["orders", filters]`
- **Mutations** con invalidación automática del caché
- **Infinite queries** para listas con scroll infinito
- **Stale time**: default de React Query (0ms — siempre revalida en background)

### 11.3 Context API

- **`AuthContext`**: user, token, loading, isAuthenticated + login/logout
- **`ToastContext`**: función `showToast()`
- Sin Redux ni Recoil — arquitectura intencionalmente minimalista

---

## 12. Capa de API

### 12.1 Configuración de Axios

**Archivo**: `/src/api/axios.ts`

```typescript
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  headers: { "Content-Type": "application/json" },
});
```

**Interceptor de request**: Agrega `Authorization: Bearer <token>` desde `localStorage`  
**Interceptor de response**: 401 → limpia auth + redirige a `/login`

### 12.2 Variables de Entorno

```
VITE_API_URL=http://localhost:5000/api   (desarrollo)
VITE_API_URL=https://api.dominio.com/api (producción)
```

### 12.3 Endpoints Completos

```
# Autenticación
POST   /auth/login
GET    /auth/me

# Productos
GET    /products
POST   /products
PUT    /products/:id
DELETE /products/:id

# Clientes
GET    /clients
POST   /clients
PUT    /clients/:id
DELETE /clients/:id

# Órdenes de venta
GET    /orders
GET    /orders/:id
POST   /orders
PUT    /orders/:id
GET    /orders/:id/invoice

# Movimientos de stock (productos)
GET    /stock-movements
GET    /stock-movements/:id
POST   /stock-movements

# Insumos
GET    /supplies
GET    /supplies/:id
POST   /supplies
PUT    /supplies/:id
DELETE /supplies/:id

# Movimientos de insumos
GET    /supply-movements

# Compras
GET    /purchases
GET    /purchases/:id
POST   /purchases
PUT    /purchases/:id
DELETE /purchases/:id

# Proveedores
GET    /suppliers
POST   /suppliers
PUT    /suppliers/:id
DELETE /suppliers/:id

# Recetas
GET    /recipes
GET    /recipes/:id
POST   /recipes
PUT    /recipes/:id
POST   /recipes/:id/produce

# Logs de producción
GET    /production-logs

# Equipo
GET    /team
POST   /team
PUT    /team/:id
DELETE /team/:id

# Configuración
GET    /settings
PUT    /settings

# Dashboard
GET    /dashboard
GET    /dashboard/optional-kpis

# Finanzas
GET    /financial/overview
GET    /financial/categories
GET    /financial/accounting
GET    /financial/product-analysis
GET    /financial/projections
GET    /financial/purchases-dashboard

# Cuentas corrientes
GET    /client-accounts
GET    /client-accounts/:clientId/entries
GET    /supplier-accounts
GET    /supplier-accounts/:supplierId/entries

# Notificaciones
GET    /notifications
PUT    /notifications/:id/read

# WhatsApp
POST   /whatsapp/start
POST   /whatsapp/stop
POST   /whatsapp/restart
```

---

## 13. Utilidades

### 13.1 Formateo de Moneda (`/src/utils/currency.ts`)

- `formatCurrency(amount, currency)`: `Intl.NumberFormat` locale `es-AR`
- Soporta: `USD`, `EUR`, `ARS`, `MXN`, `COP`
- `formatCompactCurrency(amount)`: Formato compacto con sufijos K/M para mobile

### 13.2 Manejo de Errores (`/src/utils/errors.ts`)

- `getErrorMessage(error, fallback)`: Extrae mensaje de errores Axios o JS genéricos
- Maneja: errores de API, errores de validación, errores de red

### 13.3 Validación de Stock (`/src/utils/stock.ts`)

- `canAddProductToCart(product, quantity, cartItems)`: Valida disponibilidad
- `getAvailableStock(product, cartItems)`: Stock disponible considerando carrito
- `validateCartStock(cartItems, products)`: Valida todo el carrito

### 13.4 Generación de Facturas (`/src/utils/invoice.ts`)

- `downloadOrderInvoicePdf(order, settings)`: Genera PDF con jsPDF
- Layout de factura: datos de empresa (de settings), items, totales
- Descarga via `URL.createObjectURL(blob)`
- Nombre de archivo: `factura-{orderNumber}-{date}.pdf`

---

## 14. Íconos

**Librería**: Lucide React  
**Tamaño estándar**: 18–20px  
**Stroke width**: 2px  
**Color**: `currentColor` (hereda del padre)

### Mapa de íconos por sección

| Sección | Ícono Lucide |
|---|---|
| Dashboard | `LayoutGrid` |
| Nueva Venta | `Plus` / `ShoppingCart` |
| Ventas | `ShoppingCart` |
| Clientes | `Users` |
| Productos | `Package` |
| Movimientos | `ArrowLeftRight` |
| Insumos | `Boxes` |
| Compras | `PackagePlus` |
| Proveedores | `Building2` |
| Recetas | `ClipboardCheck` |
| Panel Financiero | `LineChart` |
| Contabilidad | `ReceiptText` |
| Análisis Productos | `BarChart2` |
| Proyecciones | `TrendingUp` |
| Cuenta Clientes | `Wallet` |
| Cuenta Proveedores | `CreditCard` |
| Equipo | `UserCog` |
| Ajustes | `Settings` |
| WhatsApp | `MessageCircle` |
| Notificaciones | `Bell` |
| Salir | `LogOut` |
| Subir (positivo) | `TrendingUp` |
| Bajar (negativo) | `TrendingDown` |
| Advertencia | `AlertTriangle` |
| Éxito | `CheckCircle` |
| Carga | `Loader2` (con spin) |
| Chevron | `ChevronRight` |
| Cerrar | `X` |
| Descargar | `Download` |
| Editar | `Pencil` |
| Eliminar | `Trash2` |

---

## 15. Motion & Interacción

### Transiciones Base

```css
transition: all 0.15s ease;    /* hover, focus — acciones de UI rápidas */
transition: all 0.2s ease;     /* cambios de estado de componentes */
transition: all 0.25s ease;    /* apertura de paneles y modales */
```

### Microinteracciones

- **Hover en filas/cards**: `translateY(-1px)` + sombra aumentada
- **Click en botones**: `scale(0.98)` por ~100ms
- **Apertura de modal desktop**: `scale(0.96) → 1.0` + `opacity: 0 → 1`, 200ms
- **Bottom sheet mobile**: slide-up desde abajo, 280ms, `ease-out`
- **Toast**: slide-in desde arriba, fade-out al cerrar
- **Sidebar ítem activo**: borde izquierdo 3px + background, animado

### Loading States

- **Spinner**: `Loader2` de Lucide con `animation: spin 1s linear infinite`
- **Skeleton**: bloques redondeados pulsantes (`animate-pulse`) en lugar del contenido
- **Botón cargando**: spinner reemplaza texto, ancho fijo para evitar layout shift
- **Infinite scroll**: spinner al final de la lista mientras carga la próxima página

### Estados vacíos (Empty States)

Componentes `FinancialEmptyState` / `FinancialLoadingState` / `FinancialErrorState` en `/src/components/financial/FinancialState.tsx`:
- **Empty**: ícono + texto descriptivo + CTA opcional
- **Loading**: skeleton animado
- **Error**: ícono de error + mensaje + botón de retry

---

## 16. Diseño Responsivo

### 16.1 Estrategia Mobile-First

- CSS base escrito para mobile, `lg:` overrides para desktop
- Hook `useIsDesktop()` para renderizado condicional complejo
- Display toggles: `lg:hidden`, `hidden lg:flex`

### 16.2 Navegación

| Dispositivo | Navegación |
|---|---|
| Mobile (<1024px) | Bottom tab bar fijo (5–6 items) + topbar |
| Desktop (≥1024px) | Sidebar izquierdo fijo (256px) |
| Mobile — `/new-operation` | Sin bottom nav |
| Mobile — `/financial/*` | Bottom nav financiero propio |

### 16.3 Grids de Contenido

| Contexto | Mobile | Desktop |
|---|---|---|
| Stat cards / KPIs | `grid-cols-2` | `lg:grid-cols-4` |
| Listas de entidades | 1 columna | Lista + slide-over panel |
| Formularios | Pantalla completa | Drawer 480px lado derecho |
| Dashboard financiero | 1 columna | `lg:grid-cols-3` |

### 16.4 Patrones Mobile Específicos

- **Infinite scroll**: IntersectionObserver en sentinel al final de la lista (threshold 240px)
- **Full-screen forms**: Modales que ocupan `100dvh` en mobile
- **Keyboard safe**: Detección de `window.visualViewport` para reposicionar contenido con teclado abierto (iOS Safari)
- **Safe area**: `padding-bottom: env(safe-area-inset-bottom)` en bottom nav y bottom sheets

---

## 17. Autenticación y Autorización

### 17.1 Flujo de Autenticación

```
1. Usuario ingresa email + contraseña en /login
2. useAuth().login() → POST /auth/login
3. Respuesta: { token, user }
4. token → localStorage("fint_auth_token")
5. user → localStorage("fint_auth_user")
6. Axios interceptor agrega Authorization: Bearer <token> a todas las requests
7. App redirige a / (dashboard)
8. Al recargar: useAuth valida con GET /auth/me
9. Si 401 en cualquier request → clearAuthStorage() + redirect /login
```

### 17.2 Control de Acceso por Rol

| Módulo | admin | ventas | deposito | contabilidad | lectura |
|---|---|---|---|---|---|
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ventas | ✓ | ✓ | - | - | ✓ |
| Nueva Operación | ✓ | ✓ | - | - | - |
| Clientes | ✓ | ✓ | - | - | ✓ |
| Productos | ✓ | ✓ | ✓ | - | ✓ |
| Movimientos | ✓ | - | ✓ | - | ✓ |
| Insumos | ✓ | - | ✓ | - | ✓ |
| Compras | ✓ | - | ✓ | - | ✓ |
| Proveedores | ✓ | - | ✓ | - | ✓ |
| Recetas | ✓ | - | ✓ | - | ✓ |
| Cuentas Corrientes | ✓ | - | - | ✓ | ✓ |
| Centro Financiero | ✓ | - | - | ✓ | - |
| Equipo | ✓ | - | - | - | - |
| Ajustes | ✓ | - | - | - | - |

---

## 18. Flujos Clave

### 18.1 Crear una Venta

```
/new-operation
  → Seleccionar cliente (autocomplete)
  → Buscar + agregar productos al carrito
  → Validar stock disponible por ítem
  → Revisar: subtotal, tax (de settings), total
  → Agregar notas (opcional)
  → POST /orders { client, items[], notes }
  → Redirigir a /sales con éxito toast
```

### 18.2 Gestionar Inventario de Producto

```
/products
  → Ver lista + filtros (categoría, bajo stock)
  → Click producto → slide-over/pantalla detalle
  → Ver stock, historial de movimientos
  → O: "+" → Formulario crear/editar producto
  → SKU auto-sugerido, precio sugerido por margen
  → Guardar → POST/PUT /products
```

### 18.3 Ejecutar Producción con Receta

```
/recipes
  → Seleccionar receta → "Producir"
  → Ingresar cantidad de batches
  → Sistema calcula insumos necesarios totales
  → Validar stock de cada insumo
  → Confirmar → POST /recipes/:id/produce
  → Descuenta insumos del inventario
  → Aumenta stock del producto resultante
  → Log guardado en /production-logs
```

### 18.4 Gestionar Compra a Proveedor

```
/purchases
  → "+ Nueva compra"
  → Seleccionar proveedor + fecha + condición de pago
  → Agregar ítems (insumo + cantidad + costo unitario)
  → Guardar borrador (DRAFT)
  → "Confirmar" → CONFIRMED
  → Al recibir físicamente → "Marcar Recibida" → RECEIVED
  → Stock de insumos aumenta al recibir
```

### 18.5 Configurar WhatsApp

```
/settings → Integraciones
  → Ingresar número admin y números autorizados
  → Seleccionar formato: AR (Argentina) / INTL
  → "Iniciar servicio" → POST /whatsapp/start
  → Estado cambia a "Esperando QR"
  → Escanear QR con WhatsApp móvil
  → Estado → "Conectado"
  → Servicio activo para recibir pedidos via WhatsApp
```

---

## 19. Accesibilidad

- Todo el texto en español argentino (es-AR)
- `lang="es"` en el HTML
- `aria-label` en todos los botones de solo ícono
- `aria-current="page"` en ítem de nav activo
- `role="status"` en toasts
- Contraste mínimo 4.5:1 en texto normal
- Touch targets mínimo 44×44px en mobile
- `env(safe-area-inset-bottom)` para dispositivos con notch
- Focus ring: `outline: 2px solid primary`, `outline-offset: 2px`
- Navegación por teclado en autocomplete (flechas + Enter)
- Semántica HTML: `<button>`, `<nav>`, `<main>`, `<aside>`

---

## 20. PWA y Deploy

### 20.1 PWA

- Plugin: `vite-plugin-pwa`
- Registro de service worker en `main.tsx` con `{ immediate: true }`
- Permite instalación en mobile y desktop
- Caché offline configurable

### 20.2 Variables de Entorno

```bash
VITE_API_URL=http://localhost:5000/api   # Desarrollo
VITE_API_URL=https://api.fint.app/api   # Producción
```

### 20.3 Build

```bash
npm run dev        # Vite dev server (--host para LAN)
npm run build      # tsc + vite build
npm run preview    # Preview del build
npm run lint       # ESLint con auto-fix
npm run test       # Vitest (unit tests)
npm run ci         # lint + test + build
```

### 20.4 Testing

- **Framework**: Vitest
- Tests actuales: `errors.test.ts`, `stock.test.ts`
- Enfoque en utilidades y lógica de negocio

---

## 21. Notas de Diseño y Filosofía

- El estilo es **glassmorphism corporativo** — no es frosted glass puro, es una mezcla de superficies sólidas con transparencias y blur controlados
- El tono es **profesional y denso** — mucha información visible a la vez, no minimalista
- Los colores son **fríos** (azul + cyan) con acentos cálidos solo en alertas y métricas positivas
- En dark mode, los fondos son casi negros con tonos azul marino oscuro, nunca grises puros neutros
- El diseño es **data-first**: tablas, listas y métricas son protagonistas; no hay ilustraciones, hero images ni decoraciones innecesarias
- Todos los formularios usan **modales o bottom sheets** — nunca páginas separadas (excepto `/new-operation` que es un flujo propio)
- La tipografía usa **pesos altos** (600–700) incluso en body text para legibilidad en pantallas densas
- Las **eliminaciones son siempre soft delete** (`isActive: false`, `deletedAt: timestamp`) — nada se borra permanentemente desde el frontend
- El **infinite scroll** se usa en mobile para listas largas; el desktop puede usar paginación clásica con `PaginationBar`
- Los **números y montos** siempre van formateados con `formatCurrency` (locale `es-AR`)
- El **estado del servidor** es la única fuente de verdad — React Query gestiona el caché y la sincronización automática
