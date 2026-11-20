import type { Category, CategoryGroup } from "../types"

export interface CategorySeed {
  name: string
  group: CategoryGroup
  icon: string
  color: string
  children?: Omit<CategorySeed, "group" | "children">[]
}

export const defaultCategories: CategorySeed[] = [
  // Income
  {
    name: "Salary",
    group: "income",
    icon: "Banknote",
    color: "#22c55e",
    children: [
      { name: "Primary Job", icon: "Building2", color: "#22c55e" },
      { name: "Side Job", icon: "Briefcase", color: "#16a34a" },
    ],
  },
  { name: "Freelance", group: "income", icon: "Laptop", color: "#15803d" },
  { name: "Investments", group: "income", icon: "TrendingUp", color: "#166534" },
  { name: "Gifts Received", group: "income", icon: "Gift", color: "#14532d" },

  // Housing
  { name: "Rent", group: "housing", icon: "Home", color: "#3b82f6" },
  { name: "Mortgage", group: "housing", icon: "Building", color: "#2563eb" },
  { name: "Property Tax", group: "housing", icon: "FileText", color: "#1d4ed8" },
  { name: "Home Insurance", group: "housing", icon: "Shield", color: "#1e40af" },
  { name: "Home Maintenance", group: "housing", icon: "Wrench", color: "#1e3a8a" },

  // Transportation
  { name: "Gas", group: "transportation", icon: "Fuel", color: "#f97316" },
  { name: "Public Transit", group: "transportation", icon: "Bus", color: "#ea580c" },
  { name: "Car Payment", group: "transportation", icon: "Car", color: "#c2410c" },
  { name: "Car Insurance", group: "transportation", icon: "ShieldCheck", color: "#9a3412" },
  { name: "Parking", group: "transportation", icon: "ParkingCircle", color: "#7c2d12" },

  // Food
  { name: "Groceries", group: "food", icon: "ShoppingCart", color: "#eab308" },
  { name: "Restaurants", group: "food", icon: "UtensilsCrossed", color: "#ca8a04" },
  { name: "Coffee", group: "food", icon: "Coffee", color: "#a16207" },
  { name: "Delivery", group: "food", icon: "Truck", color: "#854d0e" },

  // Utilities
  { name: "Electricity", group: "utilities", icon: "Zap", color: "#06b6d4" },
  { name: "Water", group: "utilities", icon: "Droplets", color: "#0891b2" },
  { name: "Internet", group: "utilities", icon: "Wifi", color: "#0e7490" },
  { name: "Phone", group: "utilities", icon: "Smartphone", color: "#155e75" },

  // Healthcare
  { name: "Doctor", group: "healthcare", icon: "Stethoscope", color: "#ec4899" },
  { name: "Pharmacy", group: "healthcare", icon: "Pill", color: "#db2777" },
  { name: "Health Insurance", group: "healthcare", icon: "HeartPulse", color: "#be185d" },

  // Personal
  { name: "Clothing", group: "personal", icon: "Shirt", color: "#8b5cf6" },
  { name: "Personal Care", group: "personal", icon: "Sparkles", color: "#7c3aed" },
  { name: "Gifts Given", group: "personal", icon: "Gift", color: "#6d28d9" },

  // Entertainment
  { name: "Streaming", group: "entertainment", icon: "Play", color: "#f43f5e" },
  { name: "Games", group: "entertainment", icon: "Gamepad2", color: "#e11d48" },
  { name: "Hobbies", group: "entertainment", icon: "Palette", color: "#be123c" },
  { name: "Dining Out", group: "entertainment", icon: "Wine", color: "#9f1239" },

  // Education
  { name: "Tuition", group: "education", icon: "GraduationCap", color: "#14b8a6" },
  { name: "Books", group: "education", icon: "BookOpen", color: "#0d9488" },
  { name: "Courses", group: "education", icon: "Monitor", color: "#0f766e" },

  // Savings & Debt
  { name: "Emergency Fund", group: "savings", icon: "PiggyBank", color: "#10b981" },
  { name: "Retirement", group: "savings", icon: "Landmark", color: "#059669" },
  { name: "Credit Card Payment", group: "debt", icon: "CreditCard", color: "#ef4444" },
  { name: "Loan Payment", group: "debt", icon: "Receipt", color: "#dc2626" },

  // Other
  { name: "Uncategorized", group: "other", icon: "HelpCircle", color: "#6b7280" },
  { name: "Miscellaneous", group: "other", icon: "MoreHorizontal", color: "#9ca3af" },
]

/**
 * A user's copy of a built-in (same id) replaces it; the copy still counts as a
 * built-in (`isDefault`), so the UI offers Reset rather than Delete. Own categories follow.
 */
export function mergeCategoryCopies(builtIns: Category[], mine: Category[]): Category[] {
  const copies = new Map(mine.map((c) => [c.id, c]))
  const ids = new Set(builtIns.map((b) => b.id))
  return [
    ...builtIns.map((b) => (copies.has(b.id) ? { ...copies.get(b.id)!, isDefault: true } : b)),
    ...mine.filter((m) => !ids.has(m.id)),
  ]
}
