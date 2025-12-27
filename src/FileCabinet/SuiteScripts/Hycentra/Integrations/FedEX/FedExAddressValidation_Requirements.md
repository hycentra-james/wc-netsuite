# FedEx Address Validation & Auto Shipping Method Assignment

## Overview

This document outlines the business logic for automatic FedEx address validation and shipping method assignment when Sales Orders are created in NetSuite.

## Order Type Identification

Orders are classified into three types based on customer:

| Order Type | Identification Criteria |
|------------|------------------------|
| **Website (Shopify)** | Customer's parent ID = 330 AND `otherrefnum` starts with "WEB-" |
| **EDI** | Customer ID in [329, 275, 317, 12703] (Home Depot, Lowe's, Wayfair) |
| **Other** | All other customers |

## Ship Type Identification

Ship type is determined by the `custcol_fmt_ship_type` field on Sales Order line items:

| Ship Type | Internal ID | Logic |
|-----------|-------------|-------|
| **Small Parcel** | 1 | All line items must be Small Parcel |
| **LTL** | 2 | If ANY line item is LTL, entire order is LTL |

**Source:** `customlist_fmt_ship_type_list`

## Shipping Method Constants

| Shipping Method | Internal ID |
|-----------------|-------------|
| FedEx Ground | 19 |
| FedEx Home Delivery | 20 |

## Address Classification Mapping

FedEx Address Validation API returns a classification that maps to:

| FedEx Classification | Address Type | `custbody_hyc_address_type` | `shipisresidential` | Target Ship Method |
|---------------------|--------------|----------------------------|--------------------|--------------------|
| RESIDENTIAL | Residential | 1 | true | FedEx Home (20) |
| BUSINESS | Commercial | 2 | false | FedEx Ground (19) |
| MIXED | Residential (default) | 1 | true | FedEx Home (20) |
| UNKNOWN | Residential (default) | 1 | true | FedEx Home (20) |

## Business Logic Matrix

### On Sales Order CREATE

| Order Type | Ship Type | Current Ship Method | Validate Address? | Update Classification? | Update Ship Method? |
|------------|-----------|---------------------|-------------------|----------------------|-------------------|
| **Website** | Small Parcel | Any | ✅ Yes (API) | ✅ Yes (from API) | ✅ Yes |
| **Website** | LTL | Any | ✅ Yes (API) | ✅ Yes (from API) | ❌ No |
| **EDI** | Small Parcel | FedEx Ground (19) | ❌ No (Skip API) | ✅ Yes (Force Commercial) | ❌ No (Keep Ground) |
| **EDI** | Small Parcel | FedEx Home (20) | ❌ No (Skip API) | ✅ Yes (Force Residential) | ❌ No (Keep Home) |
| **EDI** | Small Parcel | Other FedEx | ❌ No | ❌ No | ❌ No |
| **EDI** | Small Parcel | Non-FedEx | ❌ No | ❌ No | ❌ No |
| **EDI** | LTL | Any | ✅ Yes (API) | ✅ Yes (from API) | ❌ No |
| **Other** | Any | FedEx | ✅ Yes (API) | ✅ Yes (from API) | ❌ No |
| **Other** | Any | Non-FedEx | ❌ No | ❌ No | ❌ No |

### EDI Small Parcel - Address Classification by Ship Method

| Original Ship Method | FedEx API | Address Type | `custbody_hyc_address_type` | `shipisresidential` |
|---------------------|-----------|--------------|----------------------------|--------------------|
| FedEx Ground (19) | SKIP | Commercial | 2 | false |
| FedEx Home (20) | SKIP | Residential | 1 | true |

**Rationale:** EDI customers (Home Depot, Wayfair, etc.) assign shipping methods based on their own systems. To avoid disputes about incorrect shipping method changes, we respect their ship method selection and force the address classification to match (Ground = Commercial, Home = Residential).

### On Sales Order EDIT

| Condition | Validate Address? | Update Classification? | Update Ship Method? |
|-----------|-------------------|----------------------|-------------------|
| Ship method changed TO FedEx (from non-FedEx) | ✅ Yes (API) | ✅ Yes (from API) | ❌ No |
| Address changed while FedEx | ✅ Yes (API) | ✅ Yes (from API) | ❌ No |
| EDI: Ship method changed between Ground ↔ Home | ❌ No | ❌ No (future enhancement?) | ❌ No |
| Other changes | ❌ No | ❌ No | ❌ No |

**Note:** Currently, if an EDI order's ship method is changed between Ground and Home during EDIT, the address classification is NOT updated. This may be enhanced in the future based on business requirements.

## Detailed Business Rules

### Website (Shopify) Orders

1. **Always validate address** on CREATE regardless of current shipping method
2. **Always update classification fields** (`custbody_hyc_address_type`, `shipisresidential`)
3. **Auto-assign shipping method** based on address type:
   - Residential → FedEx Home Delivery (20)
   - Commercial → FedEx Ground (19)
4. **Exception:** If order is LTL, do NOT update shipping method (LTL uses different carriers)

### EDI Orders (Home Depot, Lowe's, Wayfair)

1. **Small Parcel Orders with FedEx Ground (19) or Home (20):**
   - **Skip FedEx Address Validation API** - respect EDI customer's ship method choice
   - **Force address classification based on ship method:**
     - FedEx Ground (19) → Commercial (`custbody_hyc_address_type` = 2, `shipisresidential` = false)
     - FedEx Home (20) → Residential (`custbody_hyc_address_type` = 1, `shipisresidential` = true)
   - **Never change shipping method** - keep as assigned by EDI customer
   - **Log**: "Skipping FedEx API - respecting ship method assigned by EDI customer"

2. **Small Parcel Orders with other shipping methods:**
   - **No validation or updates** - not a Ground/Home FedEx method

3. **LTL Orders:**
   - **Call FedEx Address Validation API** - classify address for record-keeping
   - **Update classification fields** based on API response
   - **Never change shipping method** - LTL uses different carriers

4. **Rationale:** EDI customers assign shipping methods based on their systems. To avoid disputes about incorrect method changes, we respect their selection and force address type to match (Ground = Commercial, Home = Residential)

### Other Orders

1. **Validate only if** shipping method is a FedEx method
2. **Update classification fields** if validated
3. **Never update shipping method**

## Technical Implementation

### Script Details

- **Script:** `getFedExRateQuote_UE.js`
- **Type:** User Event Script
- **Event:** beforeSubmit
- **Trigger:** Sales Order CREATE and EDIT

### Key Functions

| Function | Purpose |
|----------|---------|
| `getOrderType(record)` | Determines if order is Website, EDI, or Other |
| `isOrderLTL(record)` | Checks line items for LTL ship type |
| `updateAddressClassification(record, classification)` | Updates address type fields based on FedEx API classification |
| `updateAddressClassificationForEDI(record, shipMethodId)` | Forces address type based on ship method (Ground→Commercial, Home→Residential) |
| `updateShippingMethod(record, classification, orderType, currentMethod)` | Updates shipping method based on rules |

### Dependencies

- `fedexAddressValidation.js` - FedEx Address Validation API integration
- `fedexRateQuote.js` - FedEx Rate Quote API integration

## Examples

### Example 1: Website Small Parcel to Residential Address

```
Input:
- Customer Parent: 330 (Website)
- otherrefnum: WEB-12345 (starts with "WEB-")
- Ship Type: Small Parcel (all lines)
- Current Ship Method: Any
- FedEx Classification: RESIDENTIAL

Result:
- Address Validated: ✅ (API called)
- custbody_hyc_address_type: 1 (Residential)
- shipisresidential: true
- Ship Method: Changed to FedEx Home (20)
```

### Example 2: EDI Order with FedEx Next Day (No Action)

```
Input:
- Customer: 329 (Home Depot - EDI)
- Ship Type: Small Parcel
- Current Ship Method: FedEx Next Day (not 19 or 20)

Result:
- Address Validated: ❌ NO ACTION (not Ground or Home)
- custbody_hyc_address_type: UNCHANGED
- shipisresidential: UNCHANGED
- Ship Method: UNCHANGED (preserves FedEx Next Day)
  (EDI Small Parcel with non-Ground/Home methods receive no updates)
```

### Example 3: EDI Order with FedEx Ground (Skip API, Force Commercial)

```
Input:
- Customer: 275 (Wayfair - EDI)
- Ship Type: Small Parcel
- Current Ship Method: FedEx Ground (19)
- Actual Address: Residential (but we skip API check)

Result:
- Address Validated: ❌ SKIPPED (respecting EDI customer's ship method)
- custbody_hyc_address_type: 2 (Commercial) - FORCED based on Ground
- shipisresidential: false - FORCED based on Ground
- Ship Method: UNCHANGED (stays FedEx Ground 19)
  (Respecting EDI customer's selection to avoid disputes)
```

### Example 3b: EDI Order with FedEx Home (Skip API, Force Residential)

```
Input:
- Customer: 329 (Home Depot - EDI)
- Ship Type: Small Parcel
- Current Ship Method: FedEx Home (20)
- Actual Address: Commercial (but we skip API check)

Result:
- Address Validated: ❌ SKIPPED (respecting EDI customer's ship method)
- custbody_hyc_address_type: 1 (Residential) - FORCED based on Home
- shipisresidential: true - FORCED based on Home
- Ship Method: UNCHANGED (stays FedEx Home 20)
  (Respecting EDI customer's selection to avoid disputes)
```

### Example 3c: EDI LTL Order (Call API)

```
Input:
- Customer: 329 (Home Depot - EDI)
- Ship Type: LTL (at least one line)
- Current Ship Method: Any
- FedEx Classification: BUSINESS

Result:
- Address Validated: ✅ (LTL always calls API)
- custbody_hyc_address_type: 2 (Commercial) - from API
- shipisresidential: false - from API
- Ship Method: UNCHANGED (LTL uses different carriers)
```

### Example 4: Website LTL Order

```
Input:
- Customer Parent: 330 (Website)
- otherrefnum: WEB-12345 (starts with "WEB-")
- Ship Type: LTL (at least one line)
- Current Ship Method: Any
- FedEx Classification: BUSINESS

Result:
- Address Validated: ✅ (API called)
- custbody_hyc_address_type: 2 (Commercial)
- shipisresidential: false
- Ship Method: UNCHANGED (LTL uses different carriers)
```

### Example 5: Other Order with FedEx Method

```
Input:
- Customer: Any (not Website or EDI)
- Ship Type: Any
- Current Ship Method: FedEx Ground (19)
- FedEx Classification: RESIDENTIAL

Result:
- Address Validated: ✅ (API called)
- custbody_hyc_address_type: 1 (Residential)
- shipisresidential: true
- Ship Method: UNCHANGED (Other orders never change ship method)
```

### Example 6: Other Order with Non-FedEx Method

```
Input:
- Customer: Any (not Website or EDI)
- Ship Type: Any
- Current Ship Method: UPS Ground (non-FedEx)

Result:
- Address Validated: ❌ NO ACTION (non-FedEx method)
- custbody_hyc_address_type: UNCHANGED
- shipisresidential: UNCHANGED
- Ship Method: UNCHANGED
```

## Change History

| Date | Version | Description |
|------|---------|-------------|
| 2025-12-26 | 1.0 | Initial implementation |
| 2025-12-26 | 1.1 | Updated Website order identification to require both parent=330 AND otherrefnum starts with "WEB-" |
| 2025-12-26 | 1.2 | EDI Small Parcel orders with Ground/Home: Skip API, force address type based on ship method to respect EDI customer's selection |
| 2025-12-26 | 1.3 | Documentation cleanup: Fixed examples to match implemented logic, added EDIT behavior notes, added Examples 5 & 6 for Other orders |
