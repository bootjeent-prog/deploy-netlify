import type { UserRole } from './roles';
import type { MasterDataMap } from './masterData';

export type User = {
  id: string;
  employeeCode: string;
  name: string;
  fullName: string;
  company: string;
  companyCode: string;
  department: string;
  position: string;
  email: string;
  phone: string;
  role: UserRole;
  roleName: string;
  status: string;
  location: string;
  permissions?: string[];
  mustChangePassword?: boolean;
  canLogin?: boolean;
};

export type AssetImage = {
  id: number;
  url: string;
  mime?: string;
};

export type AssetPurchaseDocument = {
  id: number;
  name: string;
  mime: string;
  url: string;
  createdAt?: string;
};

export type Asset = {
  id: string;
  assetCode: string;
  accountingAssetId: string;
  company: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  subcategory: string;
  serial: string;
  assignedTo: string;
  custodianType?: 'UNASSIGNED' | 'SHARED' | 'EMPLOYEE' | string;
  assignedEmployeeId?: string;
  responsibleDepartment?: 'IT' | 'GA' | 'HR' | string;
  department: string;
  location: string;
  status: string;
  purchaseDate: string;
  warrantyUntil: string;
  condition: number;
  purchasePrice: number;
  usefulLifeYears: number;
  salvageValue: number;
  criticality: string;
  ownershipType: string;
  ownershipTypeOther?: string;
  vendor: string;
  hasImage?: boolean;
  imageCount?: number;
  images?: AssetImage[];
  imageMime?: string;
  imageUrl?: string;
  purchaseDocumentType?: string;
  purchaseDocumentTypeOther?: string;
  purchaseDocumentNo?: string;
  purchaseDocumentDate?: string;
  taxInvoiceNo?: string;
  accountingNote?: string;
  hasPurchaseDocument?: boolean;
  purchaseDocumentName?: string;
  purchaseDocumentMime?: string;
  purchaseDocumentUrl?: string;
  purchaseDocuments?: AssetPurchaseDocument[];
  items: any[];
  repairs: any[];
  returns: any[];
  events?: any[];
  qrPrintedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Employee = User;

export type BootstrapData = {
  user: User;
  assets: Asset[];
  employees: Employee[];
  companies: any[];
  masterData: MasterDataMap;
};

export type AssignmentRequestItem = {
  id: number;
  assetCategory: string;
  assetSubcategory: string;
  requestedQuantity: number;
  specification: string;
  remarks: string;
  itemStatus: string;
  allocations: AssignmentAllocation[];
};

export type AssignmentAllocation = {
  id: number;
  requestItemId: number;
  assetId: string;
  assetName: string;
  assetCategory: string;
  assetSubcategory: string;
  assetSerial: string;
  assetStatus: string;
  assetLocation: string;
  status: string;
  reservedBy: string;
  reservedAt: string;
  handover?: AssignmentHandover | null;
};

export type AssignmentHandover = {
  id: number;
  allocationId: number;
  assetId: string;
  handedOverBy: string;
  handedOverAt: string;
  receivedBy: string;
  receivedAt: string;
  assetCondition: number;
  accessories: string[];
  handoverNote: string;
  acknowledgementStatus: string;
};

export type AssignmentRequest = {
  id: number;
  requestNo: string;
  companyCode: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  positionName: string;
  workLocation: string;
  requiredDate: string;
  requestReason: string;
  status: string;
  requestedBy: string;
  requestedByName: string;
  submittedAt: string;
  reviewedBy: string;
  reviewedByName: string;
  reviewedAt: string;
  decisionNote: string;
  createdAt: string;
  updatedAt: string;
  requestedCount: number;
  allocatedCount: number;
  completedCount: number;
  items: AssignmentRequestItem[];
};
