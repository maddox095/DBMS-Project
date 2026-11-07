export interface Fulfillment {
  contactName: string;
  email: string;
  phone: string;
  company: string;
  addressLine: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  deliveryMethod: "DELIVERY" | "PICKUP";
  requestedDate: string | null;
  taxId: string;
  notes: string;
  status: "QUOTE_REQUESTED" | "QUOTED" | "CONFIRMED";
  unitPrice: string | null;
  freight: string | null;
  taxPercent: string | null;
  subtotal: string | null;
  taxAmount: string | null;
  total: string | null;
  currency: string;
  validUntil: string | null;
  terms: string | null;
  quotedAt: string | null;
  confirmedAt: string | null;
}
