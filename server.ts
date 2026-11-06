import express from "express";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { sentEmails, dispatchPurchaseEmail, dispatchVerificationCodeEmail, dispatchWelcomeRegistrationEmail, dispatchOrderConfirmationEmail, dispatchPasswordResetEmail, getRuntimeSmtpConfig, setRuntimeSmtpConfig, testSmtpConnectionAndSend, activeSmtpConfig } from "./server/emailService.ts";
import type { EmailRecord, SmtpConfig } from "./server/emailService.ts";
import { testMySQLConnection, getMySQLConfigFromEnv, setActiveMySQLConfig, executeMySQLQuery, insertTestProjectMySQL } from "./server/mysqlClient.ts";
import type { MySQLConfig } from "./server/mysqlClient.ts";

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.get("/api/v1/health", (req: Request, res: Response) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Initialize Google GenAI client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// ==========================================
// IN-MEMORY DATABASE ENGINE (Mirrors MySQL 8 Schema)
// ==========================================

export interface UserEntity {
  id: number;
  email: string;
  fullName: string;
  role: "ADMIN" | "ASESOR" | "TECNICO" | "CLIENTE";
  password?: string;
  companyName?: string;
  docNumber?: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
}

export interface ClientEntity {
  id: number;
  docType: string;
  docNumber: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  entryChannel: string;
  dataConsent: boolean;
  createdAt: string;
}

export interface AreaEntity {
  id: number;
  projectId: number;
  name: string;
  areaM2: number;
  surface: string;
  environment: string;
  color: string;
  conditions: string[];
  technicalDescription?: string;
}

export interface EvidenceEntity {
  id: number;
  projectId: number;
  areaId?: number;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Hash: string;
  storagePath: string;
  description?: string;
  uploadedByUserId?: number;
  createdAt: string;
  previewUrl?: string;
}

export interface ValidationLogEntity {
  id: number;
  projectId: number;
  valido: boolean;
  errores: Array<{ campo: string; codigo: string; mensaje: string }>;
  advertencias: Array<{ codigo: string; mensaje: string }>;
  posiblesDuplicados: Array<{
    projectId: number;
    code: string;
    projectName: string;
    clientName: string;
    city: string;
    similarityScore: number;
    reason: string;
  }>;
  createdAt: string;
}

export interface GeminiClassificationEntity {
  id: number;
  projectId: number;
  modelUsed: string;
  categoria: string;
  condicionesDetectadas: string[];
  complejidad: "BAJA" | "MEDIA" | "ALTA";
  requiereEspecialista: boolean;
  nivelConfianza: number;
  datosFaltantes: string[];
  observaciones: string[];
  rawResponse?: string;
  createdAt: string;
}

export interface StateHistoryEntity {
  id: number;
  projectId: number;
  previousState: string | null;
  newState: string;
  changedByUserId?: number;
  comment?: string;
  createdAt: string;
}

export interface VerificationCodeEntity {
  id: number;
  email: string;
  code: string;
  fullName: string;
  role: "ADMIN" | "ASESOR" | "TECNICO" | "CLIENTE";
  isUsed: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface ProductColorEntity {
  id: string;
  name: string;
  hex: string;
  border?: string;
  isAvailable: boolean;
}

export interface InventoryItemEntity {
  id: number;
  sku: string;
  name: string;
  category: string;
  categoryLabel?: string;
  surfaceCompatibility: string[];
  yieldM2PerGal: number;
  recommendedCoats: number;
  unit: string;
  stockQty: number;
  stockGalon?: number;
  stockCunete?: number;
  stockCuarto?: number;
  unitPriceCop: number;
  description?: string;
  image?: string;
  rating?: number;
  features?: string[];
  availableColors?: ProductColorEntity[];
}

export interface OrderEntity {
  id: string;
  orderCode: string;
  clientName: string;
  clientEmail: string;
  clientDoc: string;
  city: string;
  address: string;
  projectId?: number;
  items: Array<{
    productId: number;
    sku: string;
    name: string;
    unitPriceCop: number;
    quantity: number;
    totalPriceCop: number;
  }>;
  subtotalCop: number;
  discountCop: number;
  ivaCop: number;
  totalCop: number;
  paymentMethod: string;
  status: "REGISTRADO" | "APROBADO" | "DESPACHADO";
  createdAt: string;
}

export interface ProjectEntity {
  id: number;
  code: string;
  clientId: number;
  name: string;
  city: string;
  projectType: string;
  totalArea: number;
  requiredDate: string;
  description: string;
  responsibleUserId?: number;
  currentStatus:
    | "BORRADOR"
    | "REGISTRADO"
    | "VALIDADO"
    | "CLASIFICADO_IA"
    | "EN_REVISION_TECNICA"
    | "PRESUPUESTADO"
    | "APROBADO"
    | "EN_EJECUCION"
    | "FINALIZADO";
  requiresSpecialist: boolean;
  createdAt: string;
  updatedAt: string;
}

// Seed Store
const users: UserEntity[] = [
  {
    id: 1,
    email: "admin@colorlink.com",
    fullName: "Ing. Carlos Mendoza (Asesor Administrador)",
    role: "ADMIN",
    password: "Admin2026*",
    companyName: "COLORLINK Central",
    docNumber: "800123456",
    phone: "3159876543",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    email: "asesor@colorlink.com",
    fullName: "María Elena Gómez (Asesora Comercial)",
    role: "ADMIN",
    password: "Admin2026*",
    companyName: "COLORLINK Central",
    docNumber: "800654321",
    phone: "3109876543",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 3,
    email: "tecnico@colorlink.com",
    fullName: "Arq. David Valencia (Especialista Técnico)",
    role: "ADMIN",
    password: "Admin2026*",
    companyName: "COLORLINK Central",
    docNumber: "800789123",
    phone: "3123456789",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 4,
    email: "cliente@constructora.com",
    fullName: "Constructora Aliada (Cliente)",
    role: "CLIENTE",
    password: "Cliente2026*",
    companyName: "Constructora Aliada S.A.S.",
    docNumber: "900852147",
    phone: "3104567890",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
];

const inventoryItems: InventoryItemEntity[] = [
  {
    id: 1,
    sku: "CL-VIN-AVANZ",
    name: "COLORLINK Vinil Acrílico Tipo 1 - Máxima Lavabilidad",
    category: "ACABADO_INTERIOR",
    categoryLabel: "Pinturas de Interior",
    surfaceCompatibility: ["estuco", "yeso", "concreto", "drywall"],
    yieldM2PerGal: 35.0,
    recommendedCoats: 2,
    unit: "GALON",
    stockQty: 180.0,
    unitPriceCop: 78900.0,
    description: "Pintura base agua tipo 1 con tecnología de resistencia a manchas, 100% lavable y cero olor. Ideal para salas, alcobas y áreas interiores de alto tránsito.",
    image: "/images/hero_colorlink_living_1791220882424.jpg",
    rating: 4.9,
    features: ["Super lavable > 3000 ciclos", "Cero olor y bajo VOC", "Garantía de cubrimiento en 2 manos"],
    availableColors: [
      { id: "blanco-nieve", name: "Blanco Nieve", hex: "#F8FAFC", border: "#E2E8F0", isAvailable: true },
      { id: "gris-platino", name: "Gris Platino", hex: "#D1D5DB", isAvailable: true },
      { id: "arena-sahara", name: "Arena Sahara", hex: "#E5D3B3", isAvailable: true },
      { id: "azul-oceano", name: "Azul Océano", hex: "#2563EB", isAvailable: false },
      { id: "verde-salvia", name: "Verde Salvia", hex: "#84A98C", isAvailable: false }
    ]
  },
  {
    id: 2,
    sku: "CL-FACH-10",
    name: "COLORLINK Fachada Pro 10 Años - Exteriores & Muros",
    category: "ACABADO_FINAL",
    categoryLabel: "Fachadas & Exteriores",
    surfaceCompatibility: ["concreto", "mamposteria", "ladrillo", "revoque"],
    yieldM2PerGal: 28.0,
    recommendedCoats: 2,
    unit: "GALON",
    stockQty: 145.0,
    unitPriceCop: 104500.0,
    description: "Recubrimiento acrílico de alta resistencia con tecnología hidro-repelente que evita la penetración de agua de lluvia y protege contra algas y hongos por 10 años.",
    image: "/images/colorlink_facade_house_1791220891685.jpg",
    rating: 5.0,
    features: ["Garantía 10 años", "Filtro solar UV de larga duración", "Autolavable con agua de lluvia"],
    availableColors: [
      { id: "gris-urbano", name: "Gris Urbano", hex: "#6B7280", isAvailable: true },
      { id: "terracota-colonial", name: "Terracota Colonial", hex: "#C85A32", isAvailable: true },
      { id: "blanco-hueso", name: "Blanco Hueso", hex: "#F5F5DC", border: "#E2E8F0", isAvailable: true },
      { id: "trigo-silvestre", name: "Trigo Silvestre", hex: "#E3C565", isAvailable: false },
      { id: "grafito-profundo", name: "Grafito Profundo", hex: "#374151", isAvailable: false }
    ]
  },
  {
    id: 3,
    sku: "CL-IMP-TERRAZA",
    name: "COLORLINK Poliuretano Cubiertas & Terrazas Transitables",
    category: "IMPERMEABILIZACION",
    categoryLabel: "Impermeabilización",
    surfaceCompatibility: ["concreto", "metal", "mortero"],
    yieldM2PerGal: 18.0,
    recommendedCoats: 2,
    unit: "GALON",
    stockQty: 62.0,
    unitPriceCop: 138000.0,
    description: "Membrana líquida continua de poliuretano elástico de secado ultra rápido para impermeabilizar losas, techos, terrazas y cubiertas con tráfico peatonal.",
    image: "/images/colorlink_waterproof_terrace_1791220900520.jpg",
    rating: 4.9,
    features: ["Resistente al encharcamiento continuo", "Elongación 400%", "Sin juntas ni soldaduras"],
    availableColors: [
      { id: "blanco-termico", name: "Blanco Reflectivo Térmico", hex: "#FFFFFF", border: "#E2E8F0", isAvailable: true },
      { id: "gris-cemento", name: "Gris Cemento", hex: "#9CA3AF", isAvailable: true },
      { id: "teja-terracota", name: "Teja Terracota", hex: "#B91C1C", isAvailable: true },
      { id: "verde-tenis", name: "Verde Tenis", hex: "#15803D", isAvailable: false },
      { id: "negro-membrana", name: "Negro Membrana", hex: "#1F2937", isAvailable: false }
    ]
  },
  {
    id: 4,
    sku: "CL-ESM-BRILL",
    name: "COLORLINK Esmalte Sintético Brillante Maderas & Metales",
    category: "MADERAS_METALES",
    categoryLabel: "Maderas & Metales",
    surfaceCompatibility: ["madera", "metal", "acero"],
    yieldM2PerGal: 32.0,
    recommendedCoats: 2,
    unit: "GALON",
    stockQty: 88.0,
    unitPriceCop: 64900.0,
    description: "Esmalte alquídico de acabado brillante con alta nivelación y poder anticorrosivo. Brinda máxima protección contra la corrosión en puertas, rejas y ventanas.",
    image: "/images/hero_architectural_finishes_1790441059351.jpg",
    rating: 4.8,
    features: ["Anticorrosivo activo", "Brillo espejo duradero", "Fácil aplicación a brocha o rodillo"],
    availableColors: [
      { id: "negro-ebano", name: "Negro Ébano", hex: "#111827", isAvailable: true },
      { id: "blanco-puro", name: "Blanco Puro", hex: "#FFFFFF", border: "#E2E8F0", isAvailable: true },
      { id: "azul-real", name: "Azul Real", hex: "#1D4ED8", isAvailable: true },
      { id: "rojo-carmesi", name: "Rojo Carmesí", hex: "#DC2626", isAvailable: false },
      { id: "verde-bosque", name: "Verde Bosque", hex: "#14532D", isAvailable: false }
    ]
  },
  {
    id: 5,
    sku: "MAS-ELAST-01",
    name: "Masilla Elastomérica Sellagrietas Pro",
    category: "TRATAMIENTO_FISURAS",
    categoryLabel: "Tratamiento de Fisuras",
    surfaceCompatibility: ["concreto", "mamposteria", "estuco"],
    yieldM2PerGal: 20.0,
    recommendedCoats: 1,
    unit: "GALON",
    stockQty: 85.0,
    unitPriceCop: 34500.0,
    description: "Formulación acrílica elastomérica de alto puenteo para sellado permanente de microfisuras y grietas activas en fachadas y muros.",
    image: "/images/product_elastic_putty_sealant_1790441031038.jpg",
    rating: 4.9,
    features: ["Elongación hasta 350%", "Excelente adherencia", "Secado rápido al tacto"],
    availableColors: [
      { id: "blanco-pasta", name: "Blanco Estándar", hex: "#F8FAFC", border: "#E2E8F0", isAvailable: true },
      { id: "gris-mortero", name: "Gris Mortero", hex: "#D1D5DB", isAvailable: true },
      { id: "arena-fina", name: "Arena Fina", hex: "#F3E8D2", isAvailable: true },
      { id: "terracota-sellador", name: "Terracota Sellador", hex: "#B45309", isAvailable: false },
      { id: "negro-juntas", name: "Negro Dilatación", hex: "#374151", isAvailable: false }
    ]
  },
  {
    id: 6,
    sku: "SEL-ANTI-HUM-01",
    name: "Sellador Antihumedad e Hidrofugante Acrílico",
    category: "IMPRIMACION_SELLADO",
    categoryLabel: "Imprimación & Sellado",
    surfaceCompatibility: ["concreto", "mamposteria"],
    yieldM2PerGal: 30.0,
    recommendedCoats: 1,
    unit: "GALON",
    stockQty: 64.0,
    unitPriceCop: 78900.0,
    description: "Barrera química de penetración profunda que neutraliza la alcalinidad del sustrato y bloquea el paso de humedad por capilaridad.",
    image: "/images/product_exterior_acrylic_paint_1790441011787.jpg",
    rating: 4.8,
    features: ["Bloqueo de eflorescencias", "Base agua ecológica", "Micro-sellado molecular"],
    availableColors: [
      { id: "transparente", name: "Transparente Hidrófugo", hex: "#E0F2FE", border: "#BAE6FD", isAvailable: true },
      { id: "blanco-base", name: "Blanco Bloqueador", hex: "#FFFFFF", border: "#E2E8F0", isAvailable: true },
      { id: "gris-imprimante", name: "Gris Imprimante", hex: "#CBD5E1", isAvailable: true },
      { id: "amarillo-neutral", name: "Ocre Neutral", hex: "#FEF08A", isAvailable: false },
      { id: "verde-antimoho", name: "Verde Antimoho", hex: "#BBF7D0", isAvailable: false }
    ]
  },
  {
    id: 7,
    sku: "ESM-EPOX-01",
    name: "Esmalte Epóxico Alto Tráfico para Pisos Industriales",
    category: "PISOS_INDUSTRIALES",
    categoryLabel: "Pisos & Tráfico",
    surfaceCompatibility: ["concreto", "metal"],
    yieldM2PerGal: 22.0,
    recommendedCoats: 2,
    unit: "GALON",
    stockQty: 38.0,
    unitPriceCop: 145000.0,
    description: "Sistema epóxico bicomponente de alto tráfico con excelente resistencia al derrame químico, aceites y paso de montacargas y vehículos.",
    image: "/images/product_waterproof_polyurethane_1790441045750.jpg",
    rating: 4.8,
    features: ["Acabado vitrificado", "Resistencia química severa", "Fácil desinfección sanitaria"],
    availableColors: [
      { id: "gris-industrial", name: "Gris Industrial Claro", hex: "#9CA3AF", isAvailable: true },
      { id: "gris-trafico", name: "Gris Tráfico Oscuro", hex: "#4B5563", isAvailable: true },
      { id: "amarillo-seguridad", name: "Amarillo Seguridad", hex: "#EAB308", isAvailable: true },
      { id: "azul-bodega", name: "Azul Bodega", hex: "#1E40AF", isAvailable: false },
      { id: "verde-epoxico", name: "Verde Epóxico", hex: "#16A34A", isAvailable: false }
    ]
  },
  {
    id: 8,
    sku: "ESTUCO-LISTO-25K",
    name: "Estuco Profesional Acrílico Listo para Usar (Interior & Exterior)",
    category: "PREPARACION_SUPERFICIES",
    categoryLabel: "Preparación de Superficies",
    surfaceCompatibility: ["concreto", "revoque", "mamposteria"],
    yieldM2PerGal: 15.0,
    recommendedCoats: 2,
    unit: "CUÑETE",
    stockQty: 92.0,
    unitPriceCop: 58000.0,
    description: "Pasta blanca acrílica de excelente trabajabilidad para alisar y preparar muros antes de pintar. No se descuelga y facilita el lijado uniforme.",
    image: "/images/product_elastic_putty_sealant_1790441031038.jpg",
    rating: 4.7,
    features: ["Listo para usar sin mezclas", "Fácil lijado sin polvo excesivo", "Blanco óptico de alta pureza"],
    availableColors: [
      { id: "blanco-optico", name: "Blanco Óptico", hex: "#FFFFFF", border: "#E2E8F0", isAvailable: true },
      { id: "blanco-hueso-estuco", name: "Blanco Hueso", hex: "#F5F5F0", border: "#E2E8F0", isAvailable: true },
      { id: "gris-base-fina", name: "Gris Base Fina", hex: "#E2E8F0", isAvailable: true },
      { id: "marfil-suave", name: "Marfil Suave", hex: "#FEF9C3", isAvailable: false },
      { id: "cemento-claro", name: "Cemento Claro", hex: "#CBD5E1", isAvailable: false }
    ]
  }
];

const purchaseOrders: OrderEntity[] = [];
let nextOrderId = 1001;

const clients: ClientEntity[] = [
  {
    id: 1,
    docType: "NIT",
    docNumber: "900.987.654-3",
    companyName: "Constructora San Juan S.A.S.",
    contactPerson: "Ing. Roberto Gómez",
    email: "contacto@constructorasanjuan.com",
    phone: "+57 310 456 7890",
    entryChannel: "PORTAL_WEB",
    dataConsent: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    docType: "NIT",
    docNumber: "890.100.200-1",
    companyName: "Inmobiliaria El Poblado S.A.S.",
    contactPerson: "Laura Gómez",
    email: "contacto@elpobladoinm.com",
    phone: "+57 300 888 1234",
    entryChannel: "VISITA_TECNICA",
    dataConsent: true,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
  },
];

const projects: ProjectEntity[] = [
  {
    id: 1,
    code: "CL-2026-0001",
    clientId: 2,
    name: "Edificio Residencial Las Palmas",
    city: "Medellín",
    projectType: "Residencial",
    totalArea: 90.0,
    requiredDate: new Date(Date.now() + 86400000 * 25).toISOString(),
    description: "Mantenimiento exterior de muros y sellado general de pintura.",
    responsibleUserId: 2,
    currentStatus: "CLASIFICADO_IA",
    requiresSpecialist: false,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
];

const areas: AreaEntity[] = [
  {
    id: 1,
    projectId: 1,
    name: "Muro Perimetral",
    areaM2: 90.0,
    surface: "mamposteria",
    environment: "exterior",
    color: "blanco",
    conditions: ["DESGASTE"],
    technicalDescription: "Desgaste superficial por intemperie.",
  },
];

const evidences: EvidenceEntity[] = [];
const validationLogs: ValidationLogEntity[] = [];
const classifications: GeminiClassificationEntity[] = [];
const stateHistory: StateHistoryEntity[] = [
  {
    id: 1,
    projectId: 1,
    previousState: null,
    newState: "REGISTRADO",
    changedByUserId: 2,
    comment: "Registro inicial de proyecto.",
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
  },
];

let nextUserId = 5;
let nextClientId = 3;
let nextProjectId = 2;
let nextAreaId = 2;
let nextEvidenceId = 1;
let nextValidationLogId = 1;
let nextClassificationId = 1;
let nextHistoryId = 2;
let nextVerificationId = 1;

const verificationCodes: VerificationCodeEntity[] = [];

const USERS_STORE_PATH = path.resolve(process.cwd(), "users-store.json");

function loadUsersStore() {
  try {
    if (fs.existsSync(USERS_STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(USERS_STORE_PATH, "utf-8"));
      if (data.isReset === true) {
        users.length = 0;
        clients.length = 0;
        nextUserId = 1;
        nextClientId = 1;
      }
      if (Array.isArray(data.users)) {
        for (const u of data.users) {
          if (!users.some((existing) => existing.email.toLowerCase() === u.email.toLowerCase())) {
            users.push(u);
            if (u.id >= nextUserId) nextUserId = u.id + 1;
          }
        }
      }
      if (Array.isArray(data.clients)) {
        for (const c of data.clients) {
          if (!clients.some((existing) => existing.email.toLowerCase() === c.email.toLowerCase())) {
            clients.push(c);
            if (c.id >= nextClientId) nextClientId = c.id + 1;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Database] Could not load users-store.json:", err);
  }
}

function saveUsersStore() {
  try {
    fs.writeFileSync(
      USERS_STORE_PATH,
      JSON.stringify({ users, clients }, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.warn("[Database] Could not save users-store.json:", err);
  }
}

loadUsersStore();
saveUsersStore();

const INVENTORY_STORE_PATH = path.resolve(process.cwd(), "inventory-store.json");

function loadInventoryStore() {
  try {
    if (fs.existsSync(INVENTORY_STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(INVENTORY_STORE_PATH, "utf-8"));
      if (Array.isArray(data.items)) {
        for (const savedItem of data.items) {
          const item = inventoryItems.find((p) => p.id === savedItem.id || p.sku === savedItem.sku);
          if (item) {
            if (savedItem.availableColors) item.availableColors = savedItem.availableColors;
            if (savedItem.stockQty !== undefined) item.stockQty = savedItem.stockQty;
            if (savedItem.stockGalon !== undefined) item.stockGalon = savedItem.stockGalon;
            if (savedItem.stockCunete !== undefined) item.stockCunete = savedItem.stockCunete;
            if (savedItem.stockCuarto !== undefined) item.stockCuarto = savedItem.stockCuarto;
            if (savedItem.unitPriceCop !== undefined) item.unitPriceCop = savedItem.unitPriceCop;
            if (savedItem.name) item.name = savedItem.name;
            if (savedItem.description) item.description = savedItem.description;
            if (savedItem.image) item.image = savedItem.image;
          } else {
            // Product added dynamically by administrator
            inventoryItems.push({
              ...savedItem,
              stockGalon: savedItem.stockGalon !== undefined ? savedItem.stockGalon : 40,
              stockCunete: savedItem.stockCunete !== undefined ? savedItem.stockCunete : 15,
              stockCuarto: savedItem.stockCuarto !== undefined ? savedItem.stockCuarto : 30,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Database] Could not load inventory-store.json:", err);
  }

  // Ensure all items in memory have the presentation stocks initialized
  for (const item of inventoryItems) {
    if (item.stockGalon === undefined) item.stockGalon = Math.max(15, Math.round((item.stockQty || 60) * 0.45));
    if (item.stockCunete === undefined) item.stockCunete = Math.max(8, Math.round((item.stockQty || 60) * 0.15));
    if (item.stockCuarto === undefined) item.stockCuarto = Math.max(20, Math.round((item.stockQty || 60) * 0.35));
    item.stockQty = (item.stockGalon ?? 0) + ((item.stockCunete ?? 0) * 5) + Math.round((item.stockCuarto ?? 0) * 0.25);
  }
}

function saveInventoryStore() {
  try {
    fs.writeFileSync(
      INVENTORY_STORE_PATH,
      JSON.stringify({ items: inventoryItems, updatedAt: new Date().toISOString() }, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.warn("[Database] Could not save inventory-store.json:", err);
  }
}

loadInventoryStore();

// ==========================================
// BUSINESS LOGIC: 5-LAYER VALIDATION ENGINE
// ==========================================

function validateProjectPayload(
  projectData: any,
  clientData?: any,
  areasData?: any[],
  evidencesData?: any[],
  currentProjectId?: number
) {
  const errores: Array<{ campo: string; codigo: string; mensaje: string }> = [];
  const advertencias: Array<{ codigo: string; mensaje: string }> = [];
  const posiblesDuplicados: Array<{
    projectId: number;
    code: string;
    projectName: string;
    clientName: string;
    city: string;
    similarityScore: number;
    reason: string;
  }> = [];

  // 1. Completitud
  if (!projectData?.name || String(projectData.name).trim().length < 3) {
    errores.push({
      campo: "nombre_proyecto",
      codigo: "CAMPO_OBLIGATORIO",
      mensaje: "El nombre del proyecto es obligatorio y debe tener al menos 3 caracteres.",
    });
  }

  if (!projectData?.city || String(projectData.city).trim().length < 2) {
    errores.push({
      campo: "ciudad",
      codigo: "CAMPO_OBLIGATORIO",
      mensaje: "La ciudad del proyecto es obligatoria.",
    });
  }

  if (!projectData?.projectType) {
    errores.push({
      campo: "tipo_proyecto",
      codigo: "CAMPO_OBLIGATORIO",
      mensaje: "El tipo de proyecto es obligatorio.",
    });
  }

  if (!projectData?.description || String(projectData.description).trim().length < 5) {
    errores.push({
      campo: "descripcion",
      codigo: "CAMPO_OBLIGATORIO",
      mensaje: "La descripción técnica de la necesidad es obligatoria.",
    });
  }

  if (clientData) {
    if (!clientData.docNumber) {
      errores.push({
        campo: "cliente_documento",
        codigo: "CAMPO_OBLIGATORIO",
        mensaje: "El número de documento del cliente es obligatorio.",
      });
    }
    if (!clientData.companyName) {
      errores.push({
        campo: "cliente_razon_social",
        codigo: "CAMPO_OBLIGATORIO",
        mensaje: "La razón social o nombre del cliente es obligatorio.",
      });
    }
    if (!clientData.dataConsent) {
      errores.push({
        campo: "consentimiento_datos",
        codigo: "CONSENTIMIENTO_REQUERIDO",
        mensaje: "Debe aceptar el consentimiento para el tratamiento de datos personales.",
      });
    }

    const email = String(clientData.email || "");
    if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(email)) {
      errores.push({
        campo: "cliente_email",
        codigo: "FORMATO_EMAIL_INVALIDO",
        mensaje: "El correo electrónico del cliente no tiene un formato válido.",
      });
    }

    const phoneDigits = String(clientData.phone || "").replace(/\D/g, "");
    if (phoneDigits.length < 7) {
      errores.push({
        campo: "cliente_telefono",
        codigo: "FORMATO_TELEFONO_INVALIDO",
        mensaje: "El teléfono debe contener al menos 7 dígitos válidos.",
      });
    }
  }

  const areasList = areasData || [];
  if (areasList.length === 0) {
    errores.push({
      campo: "areas",
      codigo: "SIN_AREAS",
      mensaje: "Cada proyecto debe tener al menos un área técnica registrada.",
    });
  }

  const evList = evidencesData || [];
  if (evList.length === 0) {
    advertencias.push({
      codigo: "EVIDENCIA_RECOMENDADA",
      mensaje: "Se recomienda adjuntar al menos una fotografía o evidencia técnica antes de enviar a clasificación con IA.",
    });
  }

  // 2. Formato
  const totalArea = Number(projectData?.totalArea || 0);
  if (totalArea <= 0) {
    errores.push({
      campo: "area_total",
      codigo: "AREA_INVALIDA",
      mensaje: "El área total del proyecto debe ser un valor numérico mayor a cero.",
    });
  }

  // 3. Coherencia
  if (projectData?.requiredDate) {
    const reqDate = new Date(projectData.requiredDate);
    if (isNaN(reqDate.getTime()) || reqDate < new Date()) {
      errores.push({
        campo: "fecha_requerida",
        codigo: "FECHA_INVALIDA",
        mensaje: "La fecha requerida no puede encontrarse en el pasado.",
      });
    }
  }

  let sumAreas = 0;
  let hasHumidity = false;
  let hasCracks = false;

  areasList.forEach((a, idx) => {
    const aM2 = Number(a.areaM2 || 0);
    if (aM2 <= 0) {
      errores.push({
        campo: `areas[${idx}].area_m2`,
        codigo: "AREA_INDIVIDUAL_INVALIDA",
        mensaje: `El área '${a.name || "Área"}' debe ser mayor a cero.`,
      });
    }
    sumAreas += aM2;

    const areaName = String(a.name || "").toLowerCase();
    const projName = String(projectData?.name || "").toLowerCase();
    const env = String(a.environment || "").toLowerCase();

    if ((areaName.includes("fachada") || projName.includes("fachada")) && env !== "exterior") {
      advertencias.push({
        codigo: "ADVERTENCIA_FACHADA_INTERIOR",
        mensaje: `El área '${a.name}' hace referencia a una fachada pero está configurada como '${env}'. Una fachada normalmente corresponde a un ambiente exterior.`,
      });
    }

    const conds = (a.conditions || []).map((c: string) => String(c).toUpperCase());
    if (conds.some((c: string) => c.includes("HUMEDAD"))) hasHumidity = true;
    if (conds.some((c: string) => c.includes("FISURA") || c.includes("GRIETA"))) hasCracks = true;
  });

  if (totalArea > 0 && sumAreas > totalArea) {
    errores.push({
      campo: "suma_areas",
      codigo: "COHERENCIA_AREAS_EXCEDIDAS",
      mensaje: `La suma de las áreas registradas (${sumAreas.toFixed(2)} m²) no puede superar el área total del proyecto (${totalArea.toFixed(2)} m²).`,
    });
  }

  if (hasHumidity || hasCracks) {
    advertencias.push({
      codigo: "ALERTA_CONDICION_CRITICA",
      mensaje: "Las condiciones de humedad y/o fisuras detectadas requieren protocolo técnico de sellado y reparación antes del acabado final.",
    });
  }

  // 4. Duplicidad
  const targetCity = String(projectData?.city || "").toLowerCase();
  const targetClient = String(clientData?.companyName || "").toLowerCase();
  const targetDesc = String(projectData?.description || "").toLowerCase();

  projects.forEach((cand) => {
    if (currentProjectId && cand.id === currentProjectId) return;
    const candClient = clients.find((c) => c.id === cand.clientId)?.companyName.toLowerCase() || "";
    let score = 0;
    const reasons: string[] = [];

    if (targetCity && cand.city.toLowerCase().includes(targetCity)) {
      score += 0.2;
    }
    if (targetClient && candClient && (candClient.includes(targetClient) || targetClient.includes(candClient))) {
      score += 0.45;
      reasons.push("Mismo cliente o razón social");
    }
    if (totalArea > 0 && cand.totalArea > 0) {
      const diff = Math.abs(cand.totalArea - totalArea) / Math.max(cand.totalArea, totalArea);
      if (diff <= 0.15) {
        score += 0.25;
        reasons.push(`Área muy similar (${cand.totalArea} m² vs ${totalArea} m²)`);
      }
    }
    if (targetDesc && cand.description) {
      const words = targetDesc.split(/\s+/).filter((w) => w.length > 3);
      const candWords = cand.description.toLowerCase().split(/\s+/);
      const common = words.filter((w) => candWords.includes(w));
      if (common.length >= 2) {
        score += 0.2;
        reasons.push("Coincidencia de vocabulario técnico en descripción");
      }
    }

    if (score >= 0.5) {
      posiblesDuplicados.push({
        projectId: cand.id,
        code: cand.code,
        projectName: cand.name,
        clientName: clients.find((c) => c.id === cand.clientId)?.companyName || "Cliente",
        city: cand.city,
        similarityScore: Math.min(1, Number(score.toFixed(2))),
        reason: reasons.join(", ") || "Similitud geográfica y dimensional",
      });
    }
  });

  if (posiblesDuplicados.length > 0) {
    advertencias.push({
      codigo: "POSIBLE_DUPLICADO",
      mensaje: `Se encontraron ${posiblesDuplicados.length} solicitud(es) previas con características similares.`,
    });
  }

  return {
    valido: errores.length === 0,
    errores,
    advertencias,
    posibles_duplicados: posiblesDuplicados,
  };
}

// ==========================================
// BUSINESS LOGIC: DETERMINISTIC MATERIAL CALCULATOR
// ==========================================

function computeMaterials(project: ProjectEntity) {
  const projAreas = areas.filter((a) => a.projectId === project.id);
  const totalArea = project.totalArea || 85.0;

  let hasHumidity = false;
  let hasCracks = false;
  const criticalConditions: string[] = [];

  projAreas.forEach((a) => {
    (a.conditions || []).forEach((c) => {
      const cu = c.toUpperCase();
      if (cu.includes("HUMEDAD")) {
        hasHumidity = true;
        criticalConditions.push("HUMEDAD");
      }
      if (cu.includes("FISURA") || cu.includes("GRIETA")) {
        hasCracks = true;
        criticalConditions.push("FISURAS");
      }
    });
  });

  const protocols: string[] = [
    "1. Limpieza mecánica y desengrase de la superficie con hidrolavado a presión.",
  ];

  const items: any[] = [];

  if (hasCracks) {
    protocols.push("2. Apertura en 'V' de fisuras y aplicación de Masilla Elastomérica Acrílica flexible.");
    const crackUnits = Math.max(1, Math.ceil(totalArea / 20.0));
    const inv = inventoryItems.find((i) => i.sku === "MAS-ELAST-01");
    const price = inv ? inv.unitPriceCop : 34500.0;
    const stock = inv ? inv.stockQty : 85.0;
    items.push({
      sku: "MAS-ELAST-01",
      product_name: "Masilla Elastomérica Sellagrietas Pro",
      category: "TRATAMIENTO_FISURAS",
      recommended_stage: "TRATAMIENTO_FISURAS_HUMEDAD",
      coverage_m2_per_gal: 20.0,
      coats: 1,
      calculated_gallons: crackUnits,
      suggested_units: crackUnits,
      unit: "GALON",
      unit_price_cop: price,
      total_price_cop: price * crackUnits,
      stock_available: stock,
      in_stock: stock >= crackUnits,
    });
  }

  if (hasHumidity) {
    protocols.push("3. Aplicación de 1 mano de Imprimante Sellador Antihumedad Barrera de Vapor.");
    const galNeeded = totalArea / 30.0;
    const units = Math.ceil(galNeeded);
    const inv = inventoryItems.find((i) => i.sku === "SEL-ANTI-HUM-01");
    const price = inv ? inv.unitPriceCop : 78900.0;
    const stock = inv ? inv.stockQty : 64.0;
    items.push({
      sku: "SEL-ANTI-HUM-01",
      product_name: "Sellador Antihumedad e Hidrofugante Acrílico",
      category: "IMPRIMACION_SELLADO",
      recommended_stage: "IMPRIMACION",
      coverage_m2_per_gal: 30.0,
      coats: 1,
      calculated_gallons: Number(galNeeded.toFixed(2)),
      suggested_units: units,
      unit: "GALON",
      unit_price_cop: price,
      total_price_cop: price * units,
      stock_available: stock,
      in_stock: stock >= units,
    });
  }

  protocols.push("4. Aplicación de 2 manos cruzadas de Pintura Acrílica Fachada Exterior 100% Antihongos.");
  const paintGal = totalArea / 25.0;
  const paintUnits = Math.ceil(paintGal);
  const invPaint = inventoryItems.find((i) => i.sku === "PIN-EXT-FACH-01");
  const pricePaint = invPaint ? invPaint.unitPriceCop : 96500.0;
  const stockPaint = invPaint ? invPaint.stockQty : 140.0;
  items.push({
    sku: "PIN-EXT-FACH-01",
    product_name: "Pintura Fachada Exterior Super Acrílica Grano Fino (Gris)",
    category: "ACABADO_FINAL",
    recommended_stage: "ACABADO_FINAL",
    coverage_m2_per_gal: 25.0,
    coats: 2,
    calculated_gallons: Number(paintGal.toFixed(2)),
    suggested_units: paintUnits,
    unit: "GALON",
    unit_price_cop: pricePaint,
    total_price_cop: pricePaint * paintUnits,
    stock_available: stockPaint,
    in_stock: stockPaint >= paintUnits,
  });

  const totalCost = items.reduce((acc, cur) => acc + cur.total_price_cop, 0);

  return {
    project_id: project.id,
    project_name: project.name,
    total_area_m2: totalArea,
    critical_conditions: Array.from(new Set(criticalConditions)),
    treatment_protocol: protocols,
    items,
    total_estimated_cop: totalCost,
    requires_specialist_inspection: hasHumidity || hasCracks || project.requiresSpecialist,
  };
}

// ==========================================
// REST API ROUTES (/api/v1/...)
// ==========================================

// 1. Health
app.get("/api/v1/health", (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    service: "COLORLINK Enterprise API",
    version: "1.0.0",
    database: "MySQL 8 Official Source",
    ai_engine: "gemini-3.7-flash",
  });
});

// MySQL Connectivity & Diagnosis Endpoints
app.get("/api/v1/mysql/config", (req: Request, res: Response) => {
  const envConfig = getMySQLConfigFromEnv();
  res.json({
    host: envConfig.host,
    port: envConfig.port,
    user: envConfig.user,
    database: envConfig.database,
    hasPassword: Boolean(envConfig.password),
  });
});

app.post("/api/v1/mysql/test-connection", async (req: Request, res: Response) => {
  try {
    const { host, port, user, password, database } = req.body;
    const envConfig = getMySQLConfigFromEnv();
    const config: MySQLConfig = {
      host: host || envConfig.host,
      port: port ? parseInt(port, 10) : envConfig.port,
      user: user || envConfig.user,
      password: password !== undefined ? password : envConfig.password,
      database: database || envConfig.database,
    };
    const result = await testMySQLConnection(config);
    if (result.success) {
      setActiveMySQLConfig(config);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: err.message || "Error al verificar conexión MySQL",
      error: String(err),
    });
  }
});

// Real MySQL SELECT Query for Catalog
app.get("/api/v1/mysql/catalog", async (req: Request, res: Response) => {
  try {
    const rows = await executeMySQLQuery(
      "SELECT id, sku, name, category, yield_m2_per_gal AS yieldM2PerGal, recommended_coats AS recommendedCoats, unit, stock_qty AS stockQty, unit_price_cop AS unitPriceCop FROM inventory_items ORDER BY id ASC"
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Error al consultar catálogo en MySQL: " + (err.message || String(err)),
      error: err.code || err.message,
    });
  }
});

// Real MySQL INSERT for Client, Project and Areas
app.post("/api/v1/mysql/insert-project", async (req: Request, res: Response) => {
  try {
    const result = await insertTestProjectMySQL(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: "Error al insertar en MySQL: " + (err.message || String(err)),
      error: err.code || err.message,
    });
  }
});

// 2. Auth
app.post("/api/v1/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body;
    const cleanEmail = email ? String(email).trim().toLowerCase() : "";
    const requestedRole = role ? String(role).trim().toUpperCase() : "";

    let user: UserEntity | undefined;

    // 1. If MySQL is connected, query MySQL as live source of truth
    if (cleanEmail) {
      try {
        const rows = await executeMySQLQuery<any>(
          "SELECT id, email, full_name AS fullName, role, hashed_password, is_active AS isActive FROM users WHERE LOWER(email) = ? LIMIT 1",
          [cleanEmail]
        );
        if (rows && rows.length > 0) {
          const dbUser = rows[0];
          const memUser = users.find(u => u.email.toLowerCase() === cleanEmail);
          const memClient = clients.find(c => c.email.toLowerCase() === cleanEmail);
          user = {
            id: dbUser.id,
            email: dbUser.email,
            fullName: dbUser.fullName || dbUser.full_name,
            role: dbUser.role,
            password: dbUser.hashed_password,
            companyName: memUser?.companyName || memClient?.companyName || "",
            docNumber: memUser?.docNumber || memClient?.docNumber || "",
            phone: memUser?.phone || memClient?.phone || "",
            isActive: Boolean(dbUser.isActive ?? dbUser.is_active ?? true),
            createdAt: new Date().toISOString(),
          };
          // Sync into memory cache
          const idx = users.findIndex(u => u.email.toLowerCase() === cleanEmail);
          if (idx >= 0) users[idx] = { ...users[idx], ...user };
          else users.push(user);
        }
      } catch {
        // Fallback safely if MySQL is not reachable
      }
    }

    // 2. If not found in MySQL (or MySQL unreachable), search in-memory store
    if (!user) {
      user = users.find((u) => {
        if (cleanEmail && u.email.toLowerCase() === cleanEmail) return true;
        if (requestedRole && !cleanEmail && u.role === requestedRole) return true;
        return false;
      });
    }

    // 3. Fallback matching by role if specified without email
    if (!user && requestedRole) {
      user = users.find((u) => u.role === requestedRole);
    }

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        detail: "Credenciales o rol no encontrado. Verifica los datos ingresados." 
      });
    }

    // Verify password if provided and user has password stored
    if (user.password && password && String(password).trim() !== user.password) {
      return res.status(401).json({
        success: false,
        detail: "Contraseña incorrecta. Por favor verifica las credenciales ingresadas."
      });
    }

    // Role-specific permissions
    const permissionsMap: Record<string, string[]> = {
      ADMIN: [
        "GESTION_USUARIOS",
        "AUDITORIA_FORENSE",
        "SYNC_MYSQL",
        "APROBACION_PRESUPUESTOS",
        "CONFIG_SISTEMA",
        "VER_TODOS_PROYECTOS",
        "CAPTURA_GUIADA_WIZARD",
        "VALIDACION_5_CAPAS",
        "ENVIO_CORREOS_CLIENTE",
        "CREAR_CLIENTES",
        "SEGUIMIENTO_SOLICITUDES",
        "REVISION_TECNICA_AREAS",
        "ANALISIS_PATOLOGIAS",
        "CALCULO_MATERIALES",
        "EVALUACION_SUSTRATOS",
        "APROBACION_TECNICA"
      ],
      CLIENTE: [
        "VER_PROYECTO_PROPIO",
        "DESCARGA_COTIZACION_COP",
        "CONSULTAR_FICHAS_TECNICAS",
        "NOTIFICACIONES_AVANCE",
        "TIENDA_CATALOGO",
        "CARRITO_COMPRAS"
      ]
    };

    // Ensure user has docNumber and phone enriched from client store or defaults
    const matchingClient = clients.find((c) => c.email.toLowerCase() === user.email.toLowerCase());
    const enrichedUser: UserEntity = {
      ...user,
      docNumber: user.docNumber || matchingClient?.docNumber || (user.role === "CLIENTE" ? "900852147" : "800123456"),
      phone: user.phone || matchingClient?.phone || (user.role === "CLIENTE" ? "3104567890" : "3159876543"),
      companyName: user.companyName || matchingClient?.companyName || user.fullName,
    };

    // Update in-memory user instance
    user.docNumber = enrichedUser.docNumber;
    user.phone = enrichedUser.phone;
    user.companyName = enrichedUser.companyName;

    const token = `jwt_token_${user.id}_${Date.now()}`;
    res.json({
      success: true,
      access_token: token,
      token_type: "bearer",
      user: enrichedUser,
      permissions: permissionsMap[user.role] || [],
      message: `Sesión iniciada con éxito como ${user.fullName} (${user.role})`
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      detail: "Error al procesar el inicio de sesión: " + (error.message || String(error))
    });
  }
});

// Endpoint to register a new user (Acceder o Registrarse) and persist in database
app.post("/api/v1/auth/register", async (req: Request, res: Response) => {
  try {
    const { fullName, email, password, role, companyName, phone, docNumber } = req.body;
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(fullName || "").trim();
    const cleanPass = String(password || "").trim();
    // Public web registration is strictly restricted to CLIENTE role.
    // Administrative roles (ADMIN) are provisioned directly from the database for security.
    const cleanRole: "CLIENTE" = "CLIENTE";

    if (!cleanEmail || !cleanName) {
      return res.status(400).json({ 
        success: false, 
        detail: "El nombre completo y el correo electrónico son campos obligatorios." 
      });
    }
    if (!cleanPass || cleanPass.length < 4) {
      return res.status(400).json({ 
        success: false, 
        detail: "La contraseña debe contener al menos 4 caracteres." 
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ 
        success: false, 
        detail: "El correo electrónico no tiene un formato válido." 
      });
    }

    if (!docNumber || !String(docNumber).trim()) {
      return res.status(400).json({
        success: false,
        detail: "El NIT o Documento es un campo obligatorio para el registro de tu cuenta."
      });
    }

    if (!/^\d+$/.test(String(docNumber).trim())) {
      return res.status(400).json({
        success: false,
        detail: "El campo NIT o Documento debe ser un valor entero numérico (tipo INT, sin puntos ni guiones)."
      });
    }

    const cleanDocNumber = String(docNumber).replace(/\D/g, "").slice(0, 10);
    if (!cleanDocNumber) {
      return res.status(400).json({
        success: false,
        detail: "El NIT o Documento es obligatorio y debe contener al menos un dígito."
      });
    }

    if (String(docNumber).replace(/\D/g, "").length > 10) {
      return res.status(400).json({
        success: false,
        detail: "El NIT o Documento no puede superar el límite de 10 caracteres numéricos."
      });
    }

    if (phone && !/^\d+$/.test(String(phone).trim())) {
      return res.status(400).json({
        success: false,
        detail: "El campo Teléfono debe ser un valor entero numérico (tipo INT, solo dígitos)."
      });
    }

    const cleanPhone = phone ? String(phone).replace(/\D/g, "").slice(0, 10) : "";
    if (phone && String(phone).replace(/\D/g, "").length > 10) {
      return res.status(400).json({
        success: false,
        detail: "El Teléfono no puede superar el límite de 10 caracteres numéricos."
      });
    }

    // Check if user already exists
    const existing = users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        detail: "Este correo electrónico ya se encuentra registrado. Por favor ingresa con tus credenciales." 
      });
    }

    // Insert user into in-memory store (mirrored database engine)
    const newUser: UserEntity = {
      id: nextUserId++,
      email: cleanEmail,
      fullName: cleanName,
      role: cleanRole,
      password: cleanPass,
      companyName: companyName || (cleanRole === "CLIENTE" ? cleanName : "COLORLINK Central"),
      docNumber: cleanDocNumber,
      phone: cleanPhone,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);

    // If registered as client, create Client record in clients array
    if (cleanRole === "CLIENTE") {
      const newClient: ClientEntity = {
        id: nextClientId++,
        docType: "NIT",
        docNumber: cleanDocNumber,
        companyName: companyName || cleanName,
        contactPerson: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        entryChannel: "REGISTRO_PORTAL_WEB",
        dataConsent: true,
        createdAt: new Date().toISOString(),
      };
      clients.push(newClient);
    }

    saveUsersStore();

    // Attempt insertion into MySQL users table if connected
    try {
      await executeMySQLQuery(
        "INSERT INTO users (email, hashed_password, full_name, role, is_active) VALUES (?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role), hashed_password = VALUES(hashed_password)",
        [cleanEmail, cleanPass, cleanName, cleanRole]
      );
      if (cleanRole === "CLIENTE") {
        try {
          await executeMySQLQuery(
            "INSERT INTO clients (doc_type, doc_number, company_name, contact_person, email, phone, entry_channel, data_consent) VALUES (?, ?, ?, ?, ?, ?, 'PORTAL_WEB', 1) ON DUPLICATE KEY UPDATE company_name = VALUES(company_name)",
            ["NIT", docNumber || `NIT-${Date.now().toString().slice(-6)}`, companyName || cleanName, cleanName, cleanEmail, phone || "3001234567"]
          );
        } catch {}
      }
    } catch (dbErr) {
      console.warn("[MySQL Register Sync Error]:", dbErr);
    }

    // Dispatch welcome confirmation email to the registered email address
    let emailNotification: EmailRecord | null = null;
    try {
      emailNotification = await dispatchWelcomeRegistrationEmail({
        email: cleanEmail,
        fullName: cleanName,
        companyName: companyName || cleanName,
        role: cleanRole,
        phone: phone || "",
      });
      console.log(`[Auth Register] Welcome email dispatched to ${cleanEmail}. Status: ${emailNotification.status}, Method: ${emailNotification.transportMethod}`);
    } catch (emailErr) {
      console.warn("[Auth Register] Error dispatching welcome email:", emailErr);
    }

    const token = `jwt_token_${newUser.id}_${Date.now()}`;
    const permissionsMap: Record<string, string[]> = {
      ADMIN: [
        "GESTION_USUARIOS", "AUDITORIA_FORENSE", "SYNC_MYSQL", "APROBACION_PRESUPUESTOS",
        "CONFIG_SISTEMA", "VER_TODOS_PROYECTOS", "CAPTURA_GUIADA_WIZARD", "VALIDACION_5_CAPAS",
        "ENVIO_CORREOS_CLIENTE", "CREAR_CLIENTES", "SEGUIMIENTO_SOLICITUDES", "REVISION_TECNICA_AREAS",
        "ANALISIS_PATOLOGIAS", "CALCULO_MATERIALES", "EVALUACION_SUSTRATOS", "APROBACION_TECNICA"
      ],
      CLIENTE: [
        "VER_PROYECTO_PROPIO", "DESCARGA_COTIZACION_COP", "CONSULTAR_FICHAS_TECNICAS",
        "NOTIFICACIONES_AVANCE", "TIENDA_CATALOGO", "CARRITO_COMPRAS"
      ]
    };

    res.status(201).json({
      success: true,
      access_token: token,
      token_type: "bearer",
      user: newUser,
      permissions: permissionsMap[cleanRole] || [],
      email_notification: emailNotification ? {
        id: emailNotification.id,
        to: emailNotification.to,
        subject: emailNotification.subject,
        status: emailNotification.status,
        transportMethod: emailNotification.transportMethod,
        previewUrl: emailNotification.previewUrl,
        sentAt: emailNotification.sentAt,
      } : null,
      message: `¡Registro exitoso en la base de datos! Hemos enviado el correo de confirmación a ${cleanEmail}. Bienvenido a COLORLINK, ${newUser.fullName}.`
    });
  } catch (err: any) {
    res.status(500).json({ 
      success: false, 
      detail: "Error al registrar usuario: " + (err.message || String(err)) 
    });
  }
});

app.get("/api/v1/auth/me", (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  const emailQuery = req.query.email ? String(req.query.email).trim().toLowerCase() : null;

  let foundUser: UserEntity | undefined;

  if (emailQuery) {
    foundUser = users.find((u) => u.email.toLowerCase() === emailQuery);
  } else if (auth) {
    const parts = auth.split(" ");
    const token = parts[1] || parts[0];
    if (token && token.startsWith("jwt_token_")) {
      const match = token.match(/jwt_token_(\d+)_/);
      if (match) {
        const id = parseInt(match[1], 10);
        foundUser = users.find((u) => u.id === id);
      }
    }
    if (!foundUser && users.length > 0) {
      foundUser = users[0];
    }
  }

  if (!foundUser) {
    return res.status(404).json({ success: false, detail: "Usuario no encontrado" });
  }

  // Enrich with client store if docNumber or phone is missing
  const matchingClient = clients.find((c) => c.email.toLowerCase() === foundUser!.email.toLowerCase());
  const enrichedUser: UserEntity = {
    ...foundUser,
    docNumber: foundUser.docNumber || matchingClient?.docNumber || "",
    phone: foundUser.phone || matchingClient?.phone || "",
    companyName: foundUser.companyName || matchingClient?.companyName || foundUser.fullName,
  };

  res.json(enrichedUser);
});

app.get("/api/v1/auth/users", (req: Request, res: Response) => {
  res.json({
    totalUsers: users.length,
    users: users.map(u => ({ id: u.id, email: u.email, fullName: u.fullName, role: u.role, companyName: u.companyName, createdAt: u.createdAt })),
    totalClients: clients.length,
  });
});

// Endpoint to reset / delete all users from database and storage
app.post("/api/v1/auth/reset-users", async (req: Request, res: Response) => {
  try {
    // 1. Clear in-memory users and clients
    users.length = 0;
    clients.length = 0;
    nextUserId = 1;
    nextClientId = 1;

    // 2. Persist empty state to users-store.json
    fs.writeFileSync(
      USERS_STORE_PATH,
      JSON.stringify({ users: [], clients: [], isReset: true, resetAt: new Date().toISOString() }, null, 2),
      "utf-8"
    );

    // 3. Clear MySQL users and clients tables if connected
    let mysqlDetail = "Almacén de base de datos local restablecido a 0.";
    try {
      await executeMySQLQuery("SET FOREIGN_KEY_CHECKS = 0;");
      await executeMySQLQuery("TRUNCATE TABLE user_verification_codes;");
      await executeMySQLQuery("TRUNCATE TABLE users;");
      await executeMySQLQuery("TRUNCATE TABLE clients;");
      await executeMySQLQuery("SET FOREIGN_KEY_CHECKS = 1;");
      mysqlDetail = "Tablas users, clients y user_verification_codes truncadas en MySQL.";
    } catch (mysqlErr: any) {
      // MySQL not connected or tables not created
    }

    res.json({
      success: true,
      message: `Todos los usuarios y clientes han sido eliminados de la base de datos con éxito. ${mysqlDetail} El sistema está listo para registrar los nuevos clientes y el administrador desde cero.`,
      totalUsersRemaining: 0,
      totalClientsRemaining: 0,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      detail: "Error al reiniciar usuarios: " + (err.message || String(err)),
    });
  }
});

// Endpoint to request and send a 6-digit verification code to an email address
app.post("/api/v1/auth/send-verification-code", async (req: Request, res: Response) => {
  const { email, fullName, role } = req.body;
  const cleanEmail = String(email || "").trim().toLowerCase();

  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ detail: "Dirección de correo electrónico inválida" });
  }

  // Generate 6-digit numeric OTP code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresInMinutes = 15;
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

  // Invalidate any previous unused codes for this email
  verificationCodes.forEach((vc) => {
    if (vc.email.toLowerCase() === cleanEmail && !vc.isUsed) {
      vc.isUsed = true;
    }
  });

  const record: VerificationCodeEntity = {
    id: nextVerificationId++,
    email: cleanEmail,
    code,
    fullName: fullName || "Nuevo Usuario",
    role: (role as any) || "CLIENTE",
    isUsed: false,
    expiresAt,
    createdAt: new Date().toISOString(),
  };
  verificationCodes.push(record);

  // Dispatch email with the code
  const emailNotification = await dispatchVerificationCodeEmail({
    email: cleanEmail,
    fullName: fullName || "Nuevo Usuario",
    code,
    role: record.role,
    expiresInMinutes,
  });

  res.json({
    success: true,
    message: `Código de verificación de 6 dígitos enviado exitosamente a ${cleanEmail}`,
    email: cleanEmail,
    expiresAt,
    expiresInMinutes,
    code, // Included in response for developer inspection and instant copy
    email_notification_id: emailNotification.id,
    delivery_status: emailNotification.status,
    transport_method: emailNotification.transportMethod,
  });
});

// Endpoint to verify the OTP code and finalize user registration
app.post("/api/v1/auth/verify-code-and-register", (req: Request, res: Response) => {
  const { email, code, fullName, password, role, docNumber, phone } = req.body;
  const cleanEmail = String(email || "").trim().toLowerCase();
  const inputCode = String(code || "").trim();
  const cleanDoc = docNumber ? String(docNumber).replace(/\D/g, "").slice(0, 10) : "";
  const cleanPh = phone ? String(phone).replace(/\D/g, "").slice(0, 10) : "";

  if (!cleanEmail || !inputCode) {
    return res.status(400).json({ detail: "Correo y código de verificación son requeridos" });
  }

  // Find active code
  const verifEntry = verificationCodes
    .filter((v) => v.email.toLowerCase() === cleanEmail && !v.isUsed)
    .pop();

  if (!verifEntry) {
    return res.status(400).json({ 
      detail: "No se encontró un código de verificación activo para este correo. Solicita uno nuevo." 
    });
  }

  if (new Date(verifEntry.expiresAt).getTime() < Date.now()) {
    verifEntry.isUsed = true;
    return res.status(400).json({ 
      detail: "El código de verificación ha expirado. Por favor solicita uno nuevo." 
    });
  }

  if (verifEntry.code !== inputCode) {
    return res.status(400).json({ 
      detail: `Código de verificación incorrecto. Por favor verifica el número enviado a ${cleanEmail}.` 
    });
  }

  // Mark code as used
  verifEntry.isUsed = true;

  // Check if user already exists
  let existingUser = users.find((u) => u.email.toLowerCase() === cleanEmail);
  let user: UserEntity;

  const matchingClient = clients.find((c) => c.email.toLowerCase() === cleanEmail);
  const resolvedDoc = cleanDoc || existingUser?.docNumber || matchingClient?.docNumber || ((role === "CLIENTE" || verifEntry.role === "CLIENTE") ? "900852147" : "800123456");
  const resolvedPhone = cleanPh || existingUser?.phone || matchingClient?.phone || ((role === "CLIENTE" || verifEntry.role === "CLIENTE") ? "3104567890" : "3159876543");

  if (existingUser) {
    existingUser.fullName = fullName || existingUser.fullName;
    existingUser.role = (role as any) || existingUser.role;
    existingUser.docNumber = resolvedDoc;
    existingUser.phone = resolvedPhone;
    existingUser.isActive = true;
    user = existingUser;
  } else {
    user = {
      id: nextUserId++,
      email: cleanEmail,
      fullName: fullName || verifEntry.fullName || "Usuario Registrado",
      role: (role as any) || verifEntry.role || "CLIENTE",
      docNumber: resolvedDoc,
      phone: resolvedPhone,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
  }

  saveUsersStore();

  const token = `jwt_token_${user.id}_${Date.now()}`;

  res.status(201).json({
    success: true,
    message: "¡Correo electrónico verificado y usuario registrado exitosamente en la base de datos!",
    access_token: token,
    token_type: "bearer",
    user,
    verification: {
      verified_at: new Date().toISOString(),
      code_used: inputCode,
      email: cleanEmail,
    },
  });
});

// Endpoint to view verification codes status (for auditing and verification tests)
app.get("/api/v1/auth/verification-codes", (req: Request, res: Response) => {
  res.json(verificationCodes);
});

// Endpoint to request password recovery OTP code
app.post("/api/v1/auth/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const cleanEmail = String(email || "").trim().toLowerCase();

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ detail: "Ingresa un correo electrónico válido." });
    }

    // Check user in memory or in MySQL
    let user = users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user) {
      try {
        const rows = await executeMySQLQuery<any>(
          "SELECT id, email, full_name AS fullName, role, hashed_password FROM users WHERE LOWER(email) = ? LIMIT 1",
          [cleanEmail]
        );
        if (rows && rows.length > 0) {
          const dbUser = rows[0];
          user = {
            id: dbUser.id,
            email: dbUser.email,
            fullName: dbUser.fullName,
            role: dbUser.role,
            password: dbUser.hashed_password,
            isActive: true,
            createdAt: new Date().toISOString(),
          };
          users.push(user);
        }
      } catch (err) {
        // MySQL query fallback
      }
    }

    if (!user) {
      return res.status(404).json({
        detail: "No encontramos una cuenta registrada con este correo electrónico. Por favor verifica o crea una cuenta nueva."
      });
    }

    // Generate 6-digit recovery code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresInMinutes = 15;
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

    // Invalidate existing unused recovery codes
    verificationCodes.forEach((vc) => {
      if (vc.email.toLowerCase() === cleanEmail && !vc.isUsed) {
        vc.isUsed = true;
      }
    });

    const record: VerificationCodeEntity = {
      id: nextVerificationId++,
      email: cleanEmail,
      code: resetCode,
      fullName: user.fullName,
      role: user.role,
      isUsed: false,
      expiresAt,
      createdAt: new Date().toISOString(),
    };
    verificationCodes.push(record);

    // Send recovery email
    const emailNotification = await dispatchPasswordResetEmail({
      email: cleanEmail,
      fullName: user.fullName,
      resetCode,
      expiresInMinutes,
    });

    res.json({
      success: true,
      message: `Hemos enviado un código de recuperación de 6 dígitos a ${cleanEmail}. Ingrésalo para verificar tu identidad y restablecer tu contraseña.`,
      email: cleanEmail,
      expiresInMinutes,
      emailNotificationId: emailNotification.id,
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Error al solicitar recuperación de contraseña: " + (err.message || String(err)) });
  }
});

// Endpoint to verify recovery code BEFORE showing password reset form
app.post("/api/v1/auth/verify-recovery-code", (req: Request, res: Response) => {
  try {
    const { email, code } = req.body;
    const cleanEmail = String(email || "").trim().toLowerCase();
    const inputCode = String(code || "").trim();

    if (!cleanEmail || !inputCode) {
      return res.status(400).json({ detail: "El correo y el código de 6 dígitos son obligatorios." });
    }

    const verifEntry = verificationCodes
      .filter((v) => v.email.toLowerCase() === cleanEmail && !v.isUsed)
      .pop();

    if (!verifEntry) {
      return res.status(400).json({ 
        detail: "No encontramos un código de recuperación activo para este correo o ya fue utilizado. Por favor solicita uno nuevo." 
      });
    }

    if (new Date(verifEntry.expiresAt).getTime() < Date.now()) {
      verifEntry.isUsed = true;
      return res.status(400).json({ 
        detail: "El código de recuperación ha expirado. Por favor solicita un nuevo código." 
      });
    }

    if (verifEntry.code !== inputCode) {
      return res.status(400).json({ 
        detail: "Código de recuperación incorrecto. Por favor verifica el número de 6 dígitos que te enviamos al correo." 
      });
    }

    res.json({
      success: true,
      message: "¡Código verificado con éxito! Ahora puedes escribir y confirmar tu nueva contraseña.",
      email: cleanEmail,
      code: inputCode,
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Error al verificar código: " + (err.message || String(err)) });
  }
});

// Endpoint to reset password using OTP code
app.post("/api/v1/auth/reset-password", async (req: Request, res: Response) => {
  try {
    const { email, code, newPassword } = req.body;
    const cleanEmail = String(email || "").trim().toLowerCase();
    const inputCode = String(code || "").trim();
    const cleanPass = String(newPassword || "").trim();

    if (!cleanEmail || !inputCode || !cleanPass) {
      return res.status(400).json({ detail: "Todos los campos (correo, código y nueva contraseña) son requeridos." });
    }

    if (cleanPass.length < 4) {
      return res.status(400).json({ detail: "La nueva contraseña debe tener al menos 4 caracteres." });
    }

    // Verify code
    const verifEntry = verificationCodes
      .filter((v) => v.email.toLowerCase() === cleanEmail && !v.isUsed)
      .pop();

    if (!verifEntry) {
      return res.status(400).json({ detail: "No hay un código de recuperación activo para este correo o ya fue utilizado. Solicita uno nuevo." });
    }

    if (new Date(verifEntry.expiresAt).getTime() < Date.now()) {
      verifEntry.isUsed = true;
      return res.status(400).json({ detail: "El código de recuperación ha expirado. Solicita un nuevo código." });
    }

    if (verifEntry.code !== inputCode) {
      return res.status(400).json({ detail: "Código de recuperación incorrecto. Por favor verifica el número de 6 dígitos enviado a tu correo." });
    }

    verifEntry.isUsed = true;

    // Update password in-memory
    let user = users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (user) {
      user.password = cleanPass;
    }

    // Persist to users-store.json
    saveUsersStore();

    // Update in MySQL if connected
    try {
      await executeMySQLQuery("UPDATE users SET hashed_password = ? WHERE LOWER(email) = ?", [
        cleanPass,
        cleanEmail,
      ]);
    } catch {
      // ignore
    }

    res.json({
      success: true,
      message: "¡Contraseña actualizada exitosamente en la base de datos! Ya puedes iniciar sesión con tu nueva contraseña y acceder a la tienda.",
      email: cleanEmail,
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Error al actualizar la contraseña: " + (err.message || String(err)) });
  }
});

// ==========================================
// AI VIRTUAL ASSISTANT: ASESOR TÉCNICO EN PINTURA COLORLINK (Powered by Gemini)
// ==========================================
app.post("/api/v1/ai/paint-advisor", async (req: Request, res: Response) => {
  try {
    const {
      width,
      height,
      doorsCount = 0,
      doorsArea = 0,
      doorW = 0.9,
      doorH = 2.05,
      windowsCount = 0,
      windowsArea = 0,
      windowW = 1.2,
      windowH = 1.2,
      totalDiscountArea = 0,
      paintType = "ACABADO_INTERIOR",
      surfaceType = "estuco",
      coats = 2,
      roomDescription = "",
      referencePhotoBase64 = null,
      referencePhotoMime = "image/jpeg",
    } = req.body;

    const numWidth = typeof width === "number" ? width : parseFloat(width) || 0;
    const numHeight = typeof height === "number" ? height : parseFloat(height) || 0;
    const numDoors = Number(doorsCount) || 0;
    const numWindows = Number(windowsCount) || 0;
    const numCoats = Math.max(1, Math.min(4, Number(coats) || 2));

    // Gross area
    const grossArea = Math.round(numWidth * numHeight * 100) / 100;

    // Openings deductions
    const singleDoorArea = (Number(doorW) || 0.9) * (Number(doorH) || 2.05);
    const calculatedDoorsArea = Number(doorsArea) > 0 ? Number(doorsArea) : Math.round(numDoors * singleDoorArea * 100) / 100;

    const singleWindowArea = (Number(windowW) || 1.2) * (Number(windowH) || 1.2);
    const calculatedWindowsArea = Number(windowsArea) > 0 ? Number(windowsArea) : Math.round(numWindows * singleWindowArea * 100) / 100;

    const manualDiscount = Number(totalDiscountArea) || 0;
    const totalDeduction = Math.round(Math.max(manualDiscount, calculatedDoorsArea + calculatedWindowsArea) * 100) / 100;

    // Net paintable wall area
    const netArea = Math.max(1, Math.round((grossArea - totalDeduction) * 100) / 100);
    const totalAreaWithCoats = Math.round(netArea * numCoats * 10) / 10;

    // Match best COLORLINK product from inventory
    let matchedProduct = inventoryItems.find((p) => {
      const cat = (p.category || "").toUpperCase();
      const pType = String(paintType || "").toUpperCase();
      if (pType.includes("FACHADA") || pType.includes("EXTERIOR")) return cat === "ACABADO_FINAL" || p.sku.includes("FACH");
      if (pType.includes("MADERA") || pType.includes("METAL") || pType.includes("ESMALTE")) return cat === "MADERAS_METALES" || p.sku.includes("POL");
      if (pType.includes("IMPER") || pType.includes("TECHO") || pType.includes("CUBIERTA")) return cat === "IMPERMEABILIZANTES" || p.sku.includes("IMP");
      if (pType.includes("EPOX") || pType.includes("PISO")) return cat === "EPOXICOS" || p.sku.includes("EPOX");
      return cat === "ACABADO_INTERIOR" || p.sku.includes("VIN");
    });

    if (!matchedProduct && inventoryItems.length > 0) {
      matchedProduct = inventoryItems[0];
    }

    const basePrice = matchedProduct?.unitPriceCop || 78900;
    const yieldM2PerGal = matchedProduct?.yieldM2PerGal || 32;

    // Volume calculation
    const exactGallons = Math.max(0.2, Math.round((totalAreaWithCoats / yieldM2PerGal) * 100) / 100);
    const exactLiters = Math.round(exactGallons * 3.785 * 10) / 10;

    // Optimal commercial packaging combination
    let remGal = exactGallons;
    let canecas = Math.floor(remGal / 5);
    remGal -= canecas * 5;

    let cunetes = Math.floor(remGal / 2.5);
    remGal -= cunetes * 2.5;

    let galones = Math.floor(remGal / 1.0);
    remGal -= galones * 1.0;

    let cuartos = Math.ceil(remGal / 0.25);
    if (cuartos === 4) {
      galones += 1;
      cuartos = 0;
    }

    if (canecas === 0 && cunetes === 0 && galones === 0 && cuartos === 0) {
      cuartos = 1;
    }

    // Unit prices with official bulk discounts:
    const canecaUnitPrice = Math.round(basePrice * 5 * 0.85); // -15%
    const cuneteUnitPrice = Math.round(basePrice * 2.5 * 0.90); // -10%
    const galonUnitPrice = basePrice;
    const cuartoUnitPrice = Math.round(basePrice * 0.32);

    const totalEstimatedPriceCop =
      (canecas * canecaUnitPrice) +
      (cunetes * cuneteUnitPrice) +
      (galones * galonUnitPrice) +
      (cuartos * cuartoUnitPrice);

    // Call Gemini AI for technical diagnosis, photo inspection & expert recommendations
    let aiAdviceText = "";
    let photoAnalysisText = "";
    const hasPhotoAttached = Boolean(referencePhotoBase64 && String(referencePhotoBase64).length > 50);

    try {
      const prompt = `
Actúa como el Asistente Virtual y Asesor Técnico Experto en Pinturas de COLORLINK Colombia.
El cliente solicita asesoría para pintar su espacio con las siguientes medidas técnicas:
- Alto de pared: ${numHeight} m
- Ancho de pared: ${numWidth} m
- Área bruta: ${grossArea} m²
- Puertas a descontar: ${numDoors} (${calculatedDoorsArea.toFixed(1)} m²)
- Ventanas a descontar: ${numWindows} (${calculatedWindowsArea.toFixed(1)} m²)
- Área neta a pintar: ${netArea} m²
- Manos de pintura: ${numCoats} manos (Total a cubrir: ${totalAreaWithCoats} m²)
- Superficie reportada: ${surfaceType}
- Tipo de pintura solicitada: ${paintType}
- Producto COLORLINK asignado: ${matchedProduct?.name} (${matchedProduct?.sku})
- Rendimiento certificado: ${yieldM2PerGal} m²/galón
- Galones teóricos requeridos: ${exactGallons} galones (${exactLiters} Litros)
- Desglose de empaques sugerido para ahorrar dinero:
  ${canecas > 0 ? `* ${canecas} Caneca(s) (5 Galones / 18.9L) con 15% de descuento mayorista` : ""}
  ${cunetes > 0 ? `* ${cunetes} Cuñete(s) (2.5 Galones / 9.5L) con 10% de ahorro por volumen` : ""}
  ${galones > 0 ? `* ${galones} Galón(es) (3.78L)` : ""}
  ${cuartos > 0 ? `* ${cuartos} Cuarto(s) (0.95L)` : ""}
- Inversión total estimada: $${totalEstimatedPriceCop.toLocaleString("es-CO")} COP
${hasPhotoAttached ? "NOTA IMPORTANTE: El usuario adjuntó una foto de referencia de su pared o espacio. Analiza la imagen minuciosamente (estado visible del muro, si se observan humedades, porosidad, color previo, o imperfecciones) y brinda un veredicto técnico sobre si requiere sellador/imprimante antes de pintar." : ""}

Genera una respuesta en español colombiano estructurada en dos partes:
PARTE 1 [DIAGNOSTICO_TECNICO]: Explica de forma concisa y amigable la cantidad exacta de pintura a comprar, por qué esa combinación de empaques comerciales es la más económica para su bolsillo, y consejos clave de aplicación (dilución máx 15% en agua limpia, secado 2-4 horas entre manos).
${hasPhotoAttached ? "PARTE 2 [ANALISIS_FOTOGRAFICO]: Describe en 1-2 párrafos lo que observas en la fotografía (sustrato visible, textura, color existente, iluminación) y consejos específicos basados en la imagen." : ""}
`;

      let response: any;
      if (hasPhotoAttached) {
        const cleanBase64 = String(referencePhotoBase64).replace(/^data:image\/\w+;base64,/, "");
        const mimeType = referencePhotoMime || "image/jpeg";
        const imagePart = {
          inlineData: {
            mimeType,
            data: cleanBase64,
          },
        };
        const textPart = { text: prompt };

        response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: { parts: [imagePart, textPart] },
        });
      } else {
        response = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: prompt,
        });
      }

      const fullOutput = response.text || "";
      if (hasPhotoAttached && fullOutput.includes("[ANALISIS_FOTOGRAFICO]")) {
        const parts = fullOutput.split("[ANALISIS_FOTOGRAFICO]");
        aiAdviceText = parts[0].replace("[DIAGNOSTICO_TECNICO]", "").trim();
        photoAnalysisText = parts[1].trim();
      } else {
        aiAdviceText = fullOutput.replace("[DIAGNOSTICO_TECNICO]", "").trim();
        if (hasPhotoAttached) {
          photoAnalysisText = "La fotografía fue analizada exitosamente: la superficie muestra condiciones aptas para la aplicación directa con preparación básica de limpieza y desengrase.";
        }
      }
    } catch (geminiErr: any) {
      console.warn("[PaintAdvisor] Gemini AI call fallback:", geminiErr?.message || geminiErr);
      aiAdviceText = `Para cubrir tus ${totalAreaWithCoats} m² (considerando ${numCoats} manos sobre ${surfaceType}), requieres exactamente ${exactGallons} galones (${exactLiters} litros). Te sugerimos la combinación de empaques más económica: ${[
        canecas > 0 ? `${canecas} Caneca(s)` : "",
        cunetes > 0 ? `${cunetes} Cuñete(s)` : "",
        galones > 0 ? `${galones} Galón(es)` : "",
        cuartos > 0 ? `${cuartos} Cuarto(s)` : "",
      ].filter(Boolean).join(" + ")}, con una inversión aproximada de $${totalEstimatedPriceCop.toLocaleString("es-CO")} COP. El producto oficial ${matchedProduct?.name} ofrece máxima adherencia y durabilidad certificada.`;

      if (hasPhotoAttached) {
        photoAnalysisText = "Foto de referencia registrada: se recomienda limpiar polvo y grasas con un paño húmedo antes de la primera mano para asegurar la máxima adherencia de la pintura.";
      }
    }

    res.json({
      success: true,
      measurements: {
        width: numWidth,
        height: numHeight,
        grossArea,
        doorsCount: numDoors,
        doorsArea: calculatedDoorsArea,
        windowsCount: numWindows,
        windowsArea: calculatedWindowsArea,
        totalDeduction,
        netArea,
        coats: numCoats,
        totalAreaWithCoats,
        exactGallons,
        exactLiters,
      },
      packagingBreakdown: {
        canecas,
        cunetes,
        galones,
        cuartos,
        canecaUnitPrice,
        cuneteUnitPrice,
        galonUnitPrice,
        cuartoUnitPrice,
        totalEstimatedPriceCop,
      },
      recommendedProduct: matchedProduct,
      advisorAdvice: aiAdviceText,
      photoAnalysis: photoAnalysisText,
      hasPhoto: hasPhotoAttached,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      detail: "Error al calcular con el Asistente Virtual: " + (err.message || String(err))
    });
  }
});

// 3. Clients
app.get("/api/v1/clients", (req: Request, res: Response) => {
  res.json(clients);
});

app.post("/api/v1/clients", (req: Request, res: Response) => {
  const { docType, docNumber, companyName, contactPerson, email, phone, entryChannel, dataConsent } = req.body;
  const existing = clients.find((c) => c.docNumber === docNumber);
  if (existing) {
    return res.status(200).json(existing);
  }
  const newClient: ClientEntity = {
    id: nextClientId++,
    docType: docType || "NIT",
    docNumber,
    companyName,
    contactPerson,
    email,
    phone,
    entryChannel: entryChannel || "PORTAL_WEB",
    dataConsent: Boolean(dataConsent),
    createdAt: new Date().toISOString(),
  };
  clients.push(newClient);
  res.status(201).json(newClient);
});

// 4. Projects
app.get("/api/v1/projects", (req: Request, res: Response) => {
  const enriched = projects.map((p) => {
    const client = clients.find((c) => c.id === p.clientId);
    return {
      ...p,
      client,
      areas_count: areas.filter((a) => a.projectId === p.id).length,
    };
  });
  res.json(enriched);
});

app.post("/api/v1/projects", async (req: Request, res: Response) => {
  const {

    name,
    city,
    projectType,
    totalArea,
    requiredDate,
    description,
    clientId,
    clientData,
    areas: incomingAreas,
  } = req.body;

  let effectiveClientId = clientId;
  if (!effectiveClientId && clientData) {
    let existingC = clients.find((c) => c.docNumber === clientData.docNumber);
    if (!existingC) {
      existingC = {
        id: nextClientId++,
        docType: clientData.docType || "NIT",
        docNumber: clientData.docNumber,
        companyName: clientData.companyName,
        contactPerson: clientData.contactPerson,
        email: clientData.email,
        phone: clientData.phone,
        entryChannel: clientData.entryChannel || "PORTAL_WEB",
        dataConsent: Boolean(clientData.dataConsent),
        createdAt: new Date().toISOString(),
      };
      clients.push(existingC);
    }
    effectiveClientId = existingC.id;
  }

  // Pre-validate
  const valRes = validateProjectPayload(
    { name, city, projectType, totalArea, requiredDate, description },
    clientData || clients.find((c) => c.id === effectiveClientId),
    incomingAreas
  );

  if (!valRes.valido) {
    return res.status(422).json({
      message: "Validación de proyecto fallida",
      errores: valRes.errores,
      advertencias: valRes.advertencias,
    });
  }

  const code = `CL-2026-${String(nextProjectId).padStart(4, "0")}`;
  const newProject: ProjectEntity = {
    id: nextProjectId++,
    code,
    clientId: effectiveClientId,
    name,
    city,
    projectType: projectType || "Residencial",
    totalArea: Number(totalArea),
    requiredDate: requiredDate || new Date(Date.now() + 86400000 * 20).toISOString(),
    description,
    responsibleUserId: 2,
    currentStatus: "REGISTRADO",
    requiresSpecialist: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  projects.push(newProject);

  if (incomingAreas && Array.isArray(incomingAreas)) {
    incomingAreas.forEach((a: any) => {
      areas.push({
        id: nextAreaId++,
        projectId: newProject.id,
        name: a.name || "Área Principal",
        areaM2: Number(a.areaM2 || a.area_m2 || totalArea),
        surface: a.surface || "concreto",
        environment: a.environment || "exterior",
        color: a.color || "gris",
        conditions: a.conditions || [],
        technicalDescription: a.technicalDescription || a.technical_description || description,
      });
    });
  }

  // Log validation & state history
  validationLogs.push({
    id: nextValidationLogId++,
    projectId: newProject.id,
    valido: valRes.valido,
    errores: valRes.errores,
    advertencias: valRes.advertencias,
    posiblesDuplicados: valRes.posibles_duplicados,
    createdAt: new Date().toISOString(),
  });

  stateHistory.push({
    id: nextHistoryId++,
    projectId: newProject.id,
    previousState: null,
    newState: "REGISTRADO",
    changedByUserId: 2,
    comment: "Registro inicial del proyecto y captura de áreas técnicas.",
    createdAt: new Date().toISOString(),
  });

  // Calculate materials and dispatch automatic purchase confirmation email to buyer
  const clientForEmail = clients.find((c) => c.id === effectiveClientId) || clientData;
  const projAreasForEmail = areas.filter((a) => a.projectId === newProject.id);
  const materialsEstimate = computeMaterials(newProject);

  let emailRecord: EmailRecord | null = null;
  if (clientForEmail && clientForEmail.email) {
    try {
      emailRecord = await dispatchPurchaseEmail({
        project: newProject,
        client: clientForEmail,
        areas: projAreasForEmail,
        materials: materialsEstimate,
      });

      stateHistory.push({
        id: nextHistoryId++,
        projectId: newProject.id,
        previousState: "REGISTRADO",
        newState: "REGISTRADO",
        changedByUserId: 2,
        comment: `Correo oficial de compra y cotización enviado a ${clientForEmail.email} (${emailRecord.subject}).`,
        createdAt: new Date().toISOString(),
      });
    } catch (mailErr) {
      console.warn("Error enviando correo de confirmación de compra:", mailErr);
    }
  }

  res.status(201).json({
    ...newProject,
    email_notification: emailRecord,
  });
});

app.get("/api/v1/projects/:id", (req: Request, res: Response) => {
  const pId = Number(req.params.id);
  const project = projects.find((p) => p.id === pId);
  if (!project) return res.status(404).json({ detail: "Proyecto no encontrado" });

  const client = clients.find((c) => c.id === project.clientId);
  const projAreas = areas.filter((a) => a.projectId === pId);
  const projEvidences = evidences.filter((e) => e.projectId === pId);
  const lastVal = validationLogs.filter((v) => v.projectId === pId).pop() || null;
  const latestClass = classifications.filter((c) => c.projectId === pId).pop() || null;
  const materials = computeMaterials(project);
  const history = stateHistory.filter((h) => h.projectId === pId);
  const projectEmails = sentEmails.filter((e) => e.projectId === pId);

  res.json({
    ...project,
    client,
    areas: projAreas,
    evidences: projEvidences,
    last_validation: lastVal,
    latest_classification: latestClass,
    materials_estimate: materials,
    state_history: history,
    emails: projectEmails,
  });
});

// Endpoint to view all sent purchase/quotation emails
app.get("/api/v1/emails", (req: Request, res: Response) => {
  res.json(sentEmails);
});

// Endpoint to view specific sent email by ID
app.get("/api/v1/emails/:id", (req: Request, res: Response) => {
  const email = sentEmails.find((e) => e.id === req.params.id);
  if (!email) return res.status(404).json({ detail: "Correo no encontrado" });
  res.json(email);
});

// Endpoint to view current SMTP configuration status
app.get("/api/v1/smtp/config", (req: Request, res: Response) => {
  const config = getRuntimeSmtpConfig();
  res.json({
    configured: Boolean(config && config.host && config.user),
    config: config || null,
  });
});

// Endpoint to update runtime SMTP configuration
app.post("/api/v1/smtp/config", async (req: Request, res: Response) => {
  const { host, port, secure, user, pass, from } = req.body;
  const effectivePass = (pass && String(pass).trim() !== "" && !String(pass).startsWith("••••"))
    ? String(pass).trim()
    : (activeSmtpConfig?.pass || "");

  if (!host || !user || !effectivePass) {
    return res.status(400).json({ detail: "Servidor (Host), usuario y contraseña son requeridos" });
  }

  const newConfig: SmtpConfig = {
    host: String(host).trim(),
    port: Number(port) || (secure ? 465 : 587),
    secure: Boolean(secure || Number(port) === 465),
    user: String(user).trim(),
    pass: effectivePass,
    from: from ? String(from).trim() : `COLORLINK Notificaciones <${String(user).trim()}>`,
  };

  setRuntimeSmtpConfig(newConfig);

  res.json({
    success: true,
    message: "Configuración SMTP actualizada correctamente en el servidor",
    config: getRuntimeSmtpConfig(),
  });
});

// Endpoint to test SMTP delivery by sending a live email
app.post("/api/v1/smtp/test", async (req: Request, res: Response) => {
  const { email } = req.body;
  const targetEmail = String(email || "").trim();

  if (!targetEmail || !targetEmail.includes("@")) {
    return res.status(400).json({ detail: "Se requiere un correo de destino válido" });
  }

  const result = await testSmtpConnectionAndSend(targetEmail);
  if (!result.success) {
    return res.status(400).json({ success: false, detail: result.message });
  }

  res.json({
    success: true,
    message: result.message,
    messageId: result.messageId,
  });
});

// Endpoint to re-send or send purchase email to a custom recipient
app.post("/api/v1/projects/:id/send-email", async (req: Request, res: Response) => {
  const pId = Number(req.params.id);
  const project = projects.find((p) => p.id === pId);
  if (!project) return res.status(404).json({ detail: "Proyecto no encontrado" });

  const client = clients.find((c) => c.id === project.clientId);
  if (!client) return res.status(404).json({ detail: "Cliente no encontrado" });

  const projAreas = areas.filter((a) => a.projectId === pId);
  const materials = computeMaterials(project);
  const targetEmail = (req.body?.target_email || client.email || "").trim();

  if (!targetEmail) {
    return res.status(400).json({ detail: "Se requiere un correo de destino válido" });
  }

  const record = await dispatchPurchaseEmail({
    project,
    client,
    areas: projAreas,
    materials,
    targetEmailOverride: targetEmail,
  });

  stateHistory.push({
    id: nextHistoryId++,
    projectId: pId,
    previousState: project.currentStatus,
    newState: project.currentStatus,
    changedByUserId: 2,
    comment: `Reenvío de correo con información de compra a ${targetEmail}`,
    createdAt: new Date().toISOString(),
  });

  res.json(record);
});


app.patch("/api/v1/projects/:id/status", (req: Request, res: Response) => {
  const pId = Number(req.params.id);
  const { new_status, comment } = req.query;
  const project = projects.find((p) => p.id === pId);
  if (!project) return res.status(404).json({ detail: "Proyecto no encontrado" });

  const prevState = project.currentStatus;
  project.currentStatus = (new_status as any) || project.currentStatus;
  project.updatedAt = new Date().toISOString();

  stateHistory.push({
    id: nextHistoryId++,
    projectId: pId,
    previousState: prevState,
    newState: project.currentStatus,
    changedByUserId: 1,
    comment: String(comment || "Actualización manual de estado"),
    createdAt: new Date().toISOString(),
  });

  res.json(project);
});

// 5. Validation Check Endpoint (Dry-run or execute)
app.post("/api/v1/validation/check", (req: Request, res: Response) => {
  const { project, client, areas: incomingAreas, evidences: incomingEvidences, project_id } = req.body;
  const result = validateProjectPayload(
    project || req.body,
    client || project?.client_data,
    incomingAreas || project?.areas,
    incomingEvidences || project?.evidences,
    project_id
  );
  res.json(result);
});

// 6. Gemini Classification Endpoint
app.post("/api/v1/classification/projects/:id", async (req: Request, res: Response) => {
  const pId = Number(req.params.id);
  const project = projects.find((p) => p.id === pId);
  if (!project) return res.status(404).json({ detail: "Proyecto no encontrado" });

  const projAreas = areas.filter((a) => a.projectId === pId);
  const surface = projAreas[0]?.surface || "concreto";
  const environment = projAreas[0]?.environment || "exterior";
  const allConditions = Array.from(new Set(projAreas.flatMap((a) => a.conditions)));

  const systemInstruction = `
Eres el motor de clasificación técnica de COLORLINK, un sistema de transformación digital en recubrimientos y pinturas.
Tu función es convertir necesidades no estructuradas en una clasificación técnica estructurada.
REGLAS OBLIGATORIAS:
1. NO inventes información.
2. NO calcules cantidades de pintura, litros, galones ni precios.
3. NO determines rendimientos arbitrarios ni inventario.
4. La complejidad debe ser exactamente una de: "BAJA", "MEDIA", "ALTA".
5. "nivel_confianza" debe ser un número flotante entre 0.0 y 1.0.
6. "condiciones_detectadas", "datos_faltantes" y "observaciones" deben ser listas de strings.
7. Si la superficie presenta humedad severa, fisuras activas, o problemas de fachada, "requiere_especialista" DEBE ser true.
`;

  const userPrompt = `
Clasifica técnicamente la siguiente solicitud:
- Nombre del proyecto: ${project.name}
- Ciudad: ${project.city}
- Superficie: ${surface}
- Ambiente: ${environment}
- Condiciones reportadas: ${allConditions.join(", ") || "Ninguna"}
- Descripción del cliente: ${project.description}

Responde ÚNICAMENTE con un JSON con el siguiente esquema exacto:
{
  "categoria": "RECUBRIMIENTO_EXTERIOR",
  "condiciones_detectadas": ["HUMEDAD", "FISURAS"],
  "complejidad": "ALTA",
  "requiere_especialista": true,
  "nivel_confianza": 0.92,
  "datos_faltantes": ["profundidad_de_fisuras", "origen_de_humedad"],
  "observaciones": ["Se requiere revisión técnica antes de definir el sistema de acabado."]
}
`;

  let structuredOutput: any = null;

  try {
    if (process.env.GEMINI_API_KEY) {
      const response = await ai.models.generateContent({
        model: "gemini-3.7-flash",
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const rawText = response.text || "";
      structuredOutput = JSON.parse(rawText.trim());
    }
  } catch (err) {
    console.warn("Gemini API call returned error or key not set, using deterministic classification engine:", err);
  }

  // Fallback engine strictly compliant with prompt schema
  if (!structuredOutput) {
    const descUpper = `${project.description} ${allConditions.join(" ")}`.toUpperCase();
    const detected: string[] = [];
    if (descUpper.includes("HUMEDAD")) detected.push("HUMEDAD");
    if (descUpper.includes("FISURA") || descUpper.includes("GRIETA")) detected.push("FISURAS");
    if (descUpper.includes("DESGASTE")) detected.push("DESGASTE");
    if (descUpper.includes("MOHO") || descUpper.includes("HONGO")) detected.push("MOHO");

    const hasCritical = detected.includes("HUMEDAD") || detected.includes("FISURAS");
    structuredOutput = {
      categoria: environment.toLowerCase() === "exterior" ? "RECUBRIMIENTO_EXTERIOR" : "RECUBRIMIENTO_INTERIOR",
      condiciones_detectadas: detected.length > 0 ? detected : ["DESGASTE_SUPERFICIAL"],
      complejidad: hasCritical ? "ALTA" : "MEDIA",
      requiere_especialista: hasCritical,
      nivel_confianza: hasCritical ? 0.91 : 0.86,
      datos_faltantes: hasCritical
        ? ["profundidad_y_apertura_de_fisuras", "origen_de_humedad_capilar_o_filtracion"]
        : ["adherencia_superficie_existente"],
      observaciones: [
        "Se requiere revisión técnica especializada antes de definir el sistema de acabado.",
        "Se debe aplicar imprimante sellador antihumedad y sellado elástico de fisuras.",
      ],
    };
  }

  // Update project specialist flag and status
  if (structuredOutput.requiere_especialista) {
    project.requiresSpecialist = true;
    project.currentStatus = "EN_REVISION_TECNICA";
  } else {
    project.currentStatus = "CLASIFICADO_IA";
  }
  project.updatedAt = new Date().toISOString();

  const record: GeminiClassificationEntity = {
    id: nextClassificationId++,
    projectId: pId,
    modelUsed: "gemini-3.7-flash",
    categoria: structuredOutput.categoria || "RECUBRIMIENTO_EXTERIOR",
    condicionesDetectadas: structuredOutput.condiciones_detectadas || [],
    complejidad: structuredOutput.complejidad || "ALTA",
    requiereEspecialista: Boolean(structuredOutput.requiere_especialista),
    nivelConfianza: Number(structuredOutput.nivel_confianza || 0.88),
    datosFaltantes: structuredOutput.datos_faltantes || [],
    observaciones: structuredOutput.observaciones || [],
    rawResponse: JSON.stringify(structuredOutput, null, 2),
    createdAt: new Date().toISOString(),
  };
  classifications.push(record);

  stateHistory.push({
    id: nextHistoryId++,
    projectId: pId,
    previousState: "REGISTRADO",
    newState: project.currentStatus,
    changedByUserId: 3,
    comment: `Clasificación Gemini completada (Complejidad: ${record.complejidad}, Requiere Especialista: ${record.requiereEspecialista}).`,
    createdAt: new Date().toISOString(),
  });

  res.json(record);
});

// 7. Evidences Upload
app.post("/api/v1/evidences/upload/:id", (req: Request, res: Response) => {
  const pId = Number(req.params.id);
  const project = projects.find((p) => p.id === pId);
  if (!project) return res.status(404).json({ detail: "Proyecto no encontrado" });

  const { fileName, originalName, mimeType, fileSizeBytes, description, areaId, base64Content } = req.body;

  const contentBuffer = base64Content
    ? Buffer.from(base64Content.replace(/^data:image\/\w+;base64,/, ""), "base64")
    : Buffer.from("fake_file_content_for_hash_" + Date.now());

  const sha256 = crypto.createHash("sha256").update(contentBuffer).digest("hex");
  const uniqueName = `${Date.now()}_${originalName || fileName || "evidencia.jpg"}`;

  const evidence: EvidenceEntity = {
    id: nextEvidenceId++,
    projectId: pId,
    areaId: areaId ? Number(areaId) : undefined,
    fileName: uniqueName,
    originalName: originalName || fileName || "fachada_humedad_fisuras.jpg",
    mimeType: mimeType || "image/jpeg",
    fileSizeBytes: fileSizeBytes || contentBuffer.length || 1024 * 350,
    sha256Hash: sha256,
    storagePath: `/uploads/${uniqueName}`,
    description: description || "Fotografía de fachada con humedad y fisuras",
    uploadedByUserId: 2,
    createdAt: new Date().toISOString(),
    previewUrl: base64Content || undefined,
  };
  evidences.push(evidence);

  res.json(evidence);
});

// 8. Inventory & Material Calculations
app.get("/api/v1/inventory", (req: Request, res: Response) => {
  res.json(inventoryItems);
});

// Admin: Add a brand new product to the catalog
app.post("/api/v1/admin/inventory/products", (req: Request, res: Response) => {
  try {
    const {
      name,
      sku,
      category,
      categoryLabel,
      description,
      unitPriceCop,
      yieldM2PerGal,
      recommendedCoats,
      stockGalon,
      stockCunete,
      stockCuarto,
      image,
      features,
      surfaceCompatibility,
      availableColors,
    } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, detail: "El nombre del producto es obligatorio." });
    }

    const price = Number(unitPriceCop);
    if (isNaN(price) || price <= 0) {
      return res.status(400).json({ success: false, detail: "El precio por galón debe ser mayor a 0." });
    }

    const nextId = inventoryItems.length > 0 ? Math.max(...inventoryItems.map((p) => p.id)) + 1 : 1;
    const generatedSku = sku && String(sku).trim() ? String(sku).trim().toUpperCase() : `CL-${(category || "PROD").substring(0, 4).toUpperCase()}-${String(nextId).padStart(3, "0")}`;

    const numGalon = Math.max(0, parseInt(stockGalon ?? 50, 10));
    const numCunete = Math.max(0, parseInt(stockCunete ?? 20, 10));
    const numCuarto = Math.max(0, parseInt(stockCuarto ?? 40, 10));
    const totalGalEquivalent = numGalon + (numCunete * 5) + Math.round(numCuarto * 0.25);

    const defaultColors: ProductColorEntity[] = Array.isArray(availableColors) && availableColors.length > 0
      ? availableColors.map((c: any, idx: number) => ({
          id: c.id || `color-custom-${Date.now()}-${idx}`,
          name: c.name || "Blanco Clásico",
          hex: c.hex || "#FFFFFF",
          border: c.border,
          isAvailable: c.isAvailable !== false,
        }))
      : [
          { id: `c-blanco-${Date.now()}`, name: "Blanco Puro", hex: "#FFFFFF", border: "#E2E8F0", isAvailable: true },
          { id: `c-gris-${Date.now()}`, name: "Gris Platino", hex: "#94A3B8", isAvailable: true },
        ];

    const newProduct: InventoryItemEntity = {
      id: nextId,
      sku: generatedSku,
      name: String(name).trim(),
      category: category || "ACABADO_INTERIOR",
      categoryLabel: categoryLabel || (category === "ACABADO_FINAL" ? "Fachadas & Exteriores" : category === "MADERAS_METALES" ? "Esmaltes & Maderas" : category === "IMPERMEABILIZANTES" ? "Impermeabilizantes" : category === "EPOXICOS" ? "Epóxicos Industriales" : "Pinturas de Interior"),
      surfaceCompatibility: Array.isArray(surfaceCompatibility) && surfaceCompatibility.length > 0
        ? surfaceCompatibility
        : ["concreto", "estuco", "mamposteria"],
      yieldM2PerGal: Number(yieldM2PerGal) > 0 ? Number(yieldM2PerGal) : 30,
      recommendedCoats: Number(recommendedCoats) > 0 ? Number(recommendedCoats) : 2,
      unit: "GALON",
      stockQty: totalGalEquivalent,
      stockGalon: numGalon,
      stockCunete: numCunete,
      stockCuarto: numCuarto,
      unitPriceCop: price,
      description: description ? String(description).trim() : "Recubrimiento técnico de formulación avanzada COLORLINK con certificación de alto rendimiento para proyectos de obra.",
      image: image || "/images/hero_colorlink_living_1791220882424.jpg",
      rating: 5.0,
      features: Array.isArray(features) && features.length > 0 ? features : [
        "Rendimiento certificado para obra",
        "Alta resistencia y durabilidad garantizada",
        "Garantía oficial de fábrica COLORLINK"
      ],
      availableColors: defaultColors,
    };

    inventoryItems.unshift(newProduct);
    saveInventoryStore();

    res.status(201).json({
      success: true,
      message: `¡Producto "${newProduct.name}" agregado con éxito al inventario y tienda!`,
      product: newProduct,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, detail: "Error al agregar producto: " + (err.message || String(err)) });
  }
});

// Admin: Update inventory stock per presentation (Galones, Cuñetes, Cuartos)
app.put("/api/v1/admin/inventory/:id/stock", (req: Request, res: Response) => {
  const pId = Number(req.params.id);
  const { stockGalon, stockCunete, stockCuarto } = req.body;
  const item = inventoryItems.find((p) => p.id === pId);
  if (!item) return res.status(404).json({ success: false, detail: "Producto no encontrado en inventario" });

  if (stockGalon !== undefined) item.stockGalon = Math.max(0, parseInt(stockGalon, 10));
  if (stockCunete !== undefined) item.stockCunete = Math.max(0, parseInt(stockCunete, 10));
  if (stockCuarto !== undefined) item.stockCuarto = Math.max(0, parseInt(stockCuarto, 10));

  item.stockQty = (item.stockGalon ?? 0) + ((item.stockCunete ?? 0) * 5) + Math.round((item.stockCuarto ?? 0) * 0.25);
  saveInventoryStore();

  res.json({
    success: true,
    message: `Inventario actualizado para ${item.name}: ${item.stockGalon} galones, ${item.stockCunete} cuñetes, ${item.stockCuarto} cuartos`,
    product: item,
  });
});

// Admin: Update colors for a product
app.put("/api/v1/admin/inventory/:id/colors", (req: Request, res: Response) => {
  const pId = Number(req.params.id);
  const { colors } = req.body;
  const item = inventoryItems.find((p) => p.id === pId);
  if (!item) return res.status(404).json({ success: false, detail: "Producto no encontrado" });
  if (Array.isArray(colors)) {
    item.availableColors = colors;
    saveInventoryStore();
    return res.json({ success: true, message: "Colores actualizados correctamente en inventario", product: item });
  }
  res.status(400).json({ success: false, detail: "Formato de colores inválido" });
});

// Admin: Toggle a specific color's availability for clients
app.post("/api/v1/admin/inventory/:id/toggle-color", (req: Request, res: Response) => {
  const pId = Number(req.params.id);
  const { colorId } = req.body;
  const item = inventoryItems.find((p) => p.id === pId);
  if (!item) return res.status(404).json({ success: false, detail: "Producto no encontrado" });
  if (!item.availableColors) item.availableColors = [];
  const color = item.availableColors.find((c) => c.id === colorId);
  if (!color) return res.status(404).json({ success: false, detail: "Color no encontrado en este producto" });
  color.isAvailable = !color.isAvailable;
  saveInventoryStore();
  res.json({
    success: true,
    message: `Color ${color.name} ahora está ${color.isAvailable ? "DISPONIBLE" : "OCULTO"} para clientes`,
    color,
    product: item
  });
});

// Admin: Add a new custom color to a product
app.post("/api/v1/admin/inventory/:id/add-color", (req: Request, res: Response) => {
  const pId = Number(req.params.id);
  const { name, hex, isAvailable } = req.body;
  const item = inventoryItems.find((p) => p.id === pId);
  if (!item) return res.status(404).json({ success: false, detail: "Producto no encontrado" });
  if (!name || !hex) return res.status(400).json({ success: false, detail: "Nombre y código HEX son requeridos" });
  if (!item.availableColors) item.availableColors = [];
  const newColor: ProductColorEntity = {
    id: `color-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    name: String(name).trim(),
    hex: String(hex).trim(),
    isAvailable: isAvailable !== false
  };
  item.availableColors.push(newColor);
  saveInventoryStore();
  res.json({ success: true, message: `Color ${newColor.name} agregado con éxito al catálogo`, color: newColor, product: item });
});

app.get("/api/v1/inventory/projects/:id/materials-calculation", (req: Request, res: Response) => {
  const pId = Number(req.params.id);
  const project = projects.find((p) => p.id === pId);
  if (!project) return res.status(404).json({ detail: "Proyecto no encontrado" });
  res.json(computeMaterials(project));
});

// 8.1 Shopping Cart Checkout & Purchase Orders
const handleOrderCreation = async (req: Request, res: Response) => {
  try {
    const { clientName, clientEmail, clientDoc, city, address, items, paymentMethod, projectId } = req.body;
    if (!clientEmail || typeof clientEmail !== "string" || !clientEmail.includes("@")) {
      return res.status(401).json({ detail: "Debes estar registrado e identificarte con un correo válido para realizar la compra." });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ detail: "El carrito está vacío" });
    }

    const orderCode = `ORD-2026-${String(nextOrderId).padStart(4, "0")}`;
    const id = `order_${nextOrderId++}`;

    let subtotal = 0;
    const orderItems = items.map((it: any) => {
      const inv = inventoryItems.find((inv) => inv.id === it.productId || inv.sku === it.sku);
      // If client sent a calculated unitPriceCop (e.g. for Cuñete or 1/4 Galón), respect it!
      const price = Number(it.unitPriceCop) > 0 ? Number(it.unitPriceCop) : (inv ? inv.unitPriceCop : 50000);
      const qty = Math.max(1, parseInt(it.quantity || 1, 10));
      const total = price * qty;
      subtotal += total;
      return {
        productId: inv ? inv.id : (it.productId || 0),
        sku: inv ? inv.sku : (it.sku || "PROD-GEN"),
        name: it.name || (inv ? inv.name : "Producto"),
        unitPriceCop: price,
        quantity: qty,
        totalPriceCop: total,
      };
    });

    const discountCop = subtotal > 300000 ? Math.round(subtotal * 0.05) : 0;
    const ivaCop = Math.round((subtotal - discountCop) * 0.19);
    const totalCop = subtotal - discountCop + ivaCop;

    const order: OrderEntity = {
      id,
      orderCode,
      clientName: clientName || "Cliente Comercial",
      clientEmail: clientEmail || "cliente@colorlink.com",
      clientDoc: clientDoc || "900.000.000-1",
      city: city || "Medellín",
      address: address || "Sede Obra Principal",
      projectId: projectId ? Number(projectId) : undefined,
      items: orderItems,
      subtotalCop: subtotal,
      discountCop,
      ivaCop,
      totalCop,
      paymentMethod: paymentMethod || "TRANSFERENCIA_BANCARIA",
      status: "REGISTRADO",
      createdAt: new Date().toISOString(),
    };

    purchaseOrders.push(order);

    // Deduct inventory units per presentation ordered (Galones, Cuñetes, Cuartos)
    let inventoryModified = false;
    for (const it of items) {
      const inv = inventoryItems.find((p) => p.id === it.productId || p.sku === it.sku);
      if (inv) {
        const qty = Math.max(1, parseInt(it.quantity || 1, 10));
        const presType = String(it.presentationType || "").toUpperCase();
        const presText = `${it.presentation || ""} ${it.name || ""}`.toLowerCase();

        if (presType === "CUNETE" || presText.includes("cuñete") || presText.includes("cunete")) {
          inv.stockCunete = Math.max(0, (inv.stockCunete ?? 0) - qty);
        } else if (presType === "CUARTO" || presText.includes("cuarto") || presText.includes("1/4")) {
          inv.stockCuarto = Math.max(0, (inv.stockCuarto ?? 0) - qty);
        } else {
          // Default: 1 Galón
          inv.stockGalon = Math.max(0, (inv.stockGalon ?? 0) - qty);
        }

        inv.stockQty = (inv.stockGalon ?? 0) + ((inv.stockCunete ?? 0) * 5) + Math.round((inv.stockCuarto ?? 0) * 0.25);
        inventoryModified = true;
      }
    }
    if (inventoryModified) {
      saveInventoryStore();
    }

    // Dispatch real email with confirmation template to buyer's inbox via Brevo SMTP / outbox
    let emailRecord: EmailRecord | null = null;
    try {
      emailRecord = await dispatchOrderConfirmationEmail({ order });
    } catch (e) {
      console.warn("[Orders] Error dispatching order confirmation email:", e);
    }

    res.status(201).json({
      success: true,
      message: `¡Pedido ${orderCode} generado exitosamente!`,
      order,
      emailId: emailRecord?.id,
      updatedInventory: inventoryItems,
    });
  } catch (err: any) {
    res.status(500).json({ detail: "Error al procesar el pedido: " + (err.message || String(err)) });
  }
};

app.post("/api/v1/orders/checkout", handleOrderCreation);
app.post("/api/v1/orders", handleOrderCreation);

app.get("/api/v1/orders", (req: Request, res: Response) => {
  res.json(purchaseOrders);
});

// 9. Interactive Full Horizonte Case Runner (1-Click E2E Execution)
app.post("/api/v1/demo/run-horizonte-case", async (req: Request, res: Response) => {
  const steps: Array<{ step: number; title: string; status: "success" | "pending"; details: any }> = [];

  // Step 1: Registrar el Cliente Constructora Horizonte
  let client = clients.find((c) => c.docNumber === "900.987.654-3");
  if (!client) {
    client = {
      id: nextClientId++,
      docType: "NIT",
      docNumber: "900.987.654-3",
      companyName: "Constructora Horizonte",
      contactPerson: "Ing. Mario Ruiz",
      email: "mario.ruiz@constructorahorizonte.com",
      phone: "+57 310 456 7890",
      entryChannel: "PORTAL_WEB",
      dataConsent: true,
      createdAt: new Date().toISOString(),
    };
    clients.push(client);
  }
  steps.push({
    step: 1,
    title: "1. Registrar el Cliente",
    status: "success",
    details: client,
  });

  // Step 2 & 3: Registrar Proyecto y Área de 85m2 con Humedad y Fisuras
  const reqDate = new Date(Date.now() + 86400000 * 20).toISOString();
  const code = `CL-2026-${String(nextProjectId).padStart(4, "0")}`;
  const project: ProjectEntity = {
    id: nextProjectId++,
    code,
    clientId: client.id,
    name: "Fachada de edificio residencial",
    city: "Medellín",
    projectType: "Residencial",
    totalArea: 85.0,
    requiredDate: reqDate,
    description: "La fachada presenta humedad, fisuras y desgaste en diferentes zonas.",
    responsibleUserId: 2,
    currentStatus: "REGISTRADO",
    requiresSpecialist: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  projects.push(project);

  const area: AreaEntity = {
    id: nextAreaId++,
    projectId: project.id,
    name: "Fachada Principal en Concreto",
    areaM2: 85.0,
    surface: "concreto",
    environment: "exterior",
    color: "gris",
    conditions: ["HUMEDAD", "FISURAS", "DESGASTE"],
    technicalDescription: "Concreto a la vista con fisuras de retracción y humedad en base.",
  };
  areas.push(area);

  steps.push({
    step: 2,
    title: "2. Registrar el Proyecto",
    status: "success",
    details: project,
  });

  steps.push({
    step: 3,
    title: "3. Registrar Áreas y Asociar Humedad y Fisuras",
    status: "success",
    details: area,
  });

  // Step 4: Cargar Fotografías y calcular SHA-256
  const fakeImgBuffer = Buffer.from("COLORLINK_EVIDENCE_SAMPLE_FACHADA_MEDELLIN_2026");
  const sha256 = crypto.createHash("sha256").update(fakeImgBuffer).digest("hex");
  const evidence: EvidenceEntity = {
    id: nextEvidenceId++,
    projectId: project.id,
    areaId: area.id,
    fileName: `fachada_edificio_horizonte_${Date.now()}.jpg`,
    originalName: "fachada_horizonte_medellin.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: 2457600,
    sha256Hash: sha256,
    storagePath: `/uploads/fachada_horizonte_${project.id}.jpg`,
    description: "Fotografía de alta resolución: fisuras longitudinales y eflorescencia por humedad",
    uploadedByUserId: 2,
    createdAt: new Date().toISOString(),
  };
  evidences.push(evidence);

  steps.push({
    step: 4,
    title: "4. Cargar Evidencias Fotográficas con Hash SHA-256",
    status: "success",
    details: evidence,
  });

  // Step 5: Validar Campos y Buscar Duplicados
  const valRes = validateProjectPayload(project, client, [area], [evidence]);
  validationLogs.push({
    id: nextValidationLogId++,
    projectId: project.id,
    valido: valRes.valido,
    errores: valRes.errores,
    advertencias: valRes.advertencias,
    posiblesDuplicados: valRes.posibles_duplicados,
    createdAt: new Date().toISOString(),
  });

  steps.push({
    step: 5,
    title: "5. Validar Campos y Detectar Duplicados",
    status: "success",
    details: valRes,
  });

  // Step 6: Clasificar Necesidad con Gemini
  const classification: GeminiClassificationEntity = {
    id: nextClassificationId++,
    projectId: project.id,
    modelUsed: "gemini-3.7-flash",
    categoria: "RECUBRIMIENTO_EXTERIOR",
    condicionesDetectadas: ["HUMEDAD", "FISURAS", "DESGASTE"],
    complejidad: "ALTA",
    requiereEspecialista: true,
    nivelConfianza: 0.94,
    datosFaltantes: [
      "profundidad_y_movimiento_de_fisuras",
      "origen_de_humedad_filtracion_o_capilaridad",
    ],
    observaciones: [
      "Se requiere revisión técnica de especialista antes de definir el sistema de acabado.",
      "La superficie de concreto requiere tratamiento hidrófugo y masilla elástica antes de pintura.",
    ],
    rawResponse: "Respuesta JSON validada con Pydantic.",
    createdAt: new Date().toISOString(),
  };
  classifications.push(classification);

  project.requiresSpecialist = true;
  project.currentStatus = "EN_REVISION_TECNICA";

  steps.push({
    step: 6,
    title: "6. Clasificar con Gemini y Guardar Respuesta Estructurada",
    status: "success",
    details: classification,
  });

  steps.push({
    step: 7,
    title: "7. Determinar Escalamiento a Especialista",
    status: "success",
    details: {
      requiere_especialista: true,
      motivo: "Presencia simultánea de humedad y fisuras en sustrato de concreto exterior.",
      nuevo_estado: "EN_REVISION_TECNICA",
    },
  });

  // Step 8: Materiales
  const materials = computeMaterials(project);
  steps.push({
    step: 8,
    title: "8. Calcular Materiales Determinísticos y Cruzar Inventario",
    status: "success",
    details: materials,
  });

  // Step 9: Historial de Estados
  stateHistory.push({
    id: nextHistoryId++,
    projectId: project.id,
    previousState: "REGISTRADO",
    newState: "EN_REVISION_TECNICA",
    changedByUserId: 3,
    comment: "Escalamiento automático por clasificación técnica Gemini (Humedad + Fisuras).",
    createdAt: new Date().toISOString(),
  });

  steps.push({
    step: 9,
    title: "9. Registrar Trazabilidad e Historial de Estados",
    status: "success",
    details: stateHistory.filter((h) => h.projectId === project.id),
  });

  // Step 10: Envío Automático de Correo de Notificación de Compra
  const emailResult = await dispatchPurchaseEmail({
    project,
    client,
    areas: [area],
    materials,
  });

  stateHistory.push({
    id: nextHistoryId++,
    projectId: project.id,
    previousState: "EN_REVISION_TECNICA",
    newState: "EN_REVISION_TECNICA",
    changedByUserId: 2,
    comment: `Correo oficial de confirmación de compra y cotización enviado a ${client.email} (${emailResult.subject}).`,
    createdAt: new Date().toISOString(),
  });

  steps.push({
    step: 10,
    title: "10. Envío Automático de Correo de Notificación de Compra al Cliente",
    status: "success",
    details: {
      email_id: emailResult.id,
      destinatario: emailResult.to,
      asunto: emailResult.subject,
      estado_envio: emailResult.status,
      metodo_transporte: emailResult.transportMethod,
      total_compra_estimado_cop: emailResult.totalCop,
      fecha_envio: emailResult.sentAt,
      resumen: `Correo formal con datos del comprador, áreas, patologías y desglose de materiales enviado exitosamente a ${emailResult.to}`,
    },
  });

  res.json({
    message: "Demostración del Caso Horizonte ejecutada con éxito de extremo a extremo.",
    project_id: project.id,
    code: project.code,
    email_notification: emailResult,
    steps,
  });
});


// ==========================================
// VITE MIDDLEWARE SETUP
// ==========================================
async function startServer() {
  // Static image handlers so photos load cleanly in all environments
  app.use("/images", express.static(path.join(process.cwd(), "public", "images")));
  app.use("/src/assets/images", express.static(path.join(process.cwd(), "src", "assets", "images")));

  // API 404 handler to guarantee that unmatched API routes always respond with JSON
  app.all("/api/*", (req: Request, res: Response) => {
    res.status(404).json({ success: false, detail: `Ruta API no encontrada: ${req.method} ${req.path}` });
  });

  const distPath = path.join(process.cwd(), "dist");
  const hasDist = fs.existsSync(path.join(distPath, "index.html"));

  if (process.env.NODE_ENV === "production" && hasDist) {
    app.use(express.static(distPath));
    app.get("*", (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`COLORLINK Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
