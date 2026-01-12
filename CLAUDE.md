# Water Creation NetSuite Development

This is the NetSuite SuiteScript development workspace for Water Creation. Claude Code loads this file automatically when working in this directory.

## Project Overview

Water Creation is a bathroom fixtures company that sells through multiple channels:
- **Website (Shopify)** - Direct-to-consumer sales
- **EDI Partners** - Home Depot, Lowe's, Wayfair
- **Other channels** - Various B2B customers

**Tech Stack:**
- NetSuite (ERP)
- Shopify (E-commerce)
- Celigo (iPaaS Integration)
- Rithum (Product Syndication)
- SPS Commerce (EDI)
- FedEx API (Shipping)

**Odoo Project ID:** 10 (for task tracking via Odoo MCP)

---

## Key Business Logic

### Order Types

Orders are classified based on customer for different processing rules:

| Order Type | Identification | Description |
|------------|----------------|-------------|
| **Website** | Customer parent = 330 AND `otherrefnum` starts with "WEB-" | Shopify orders |
| **EDI** | Customer ID in [329, 275, 317, 12703] | Big box retailers |
| **Other** | All other customers | B2B, manual orders |

### EDI Customer IDs

| Customer | Internal ID | Notes |
|----------|-------------|-------|
| Home Depot | 317 | |
| Home Depot Pro | 12703 | |
| Lowe's | 275 | |
| Wayfair | 329 | |

### Ship Types

Determined by `custcol_fmt_ship_type` on Sales Order line items:

| Ship Type | Internal ID | Logic |
|-----------|-------------|-------|
| Small Parcel | 1 | FedEx shipping |
| LTL | 2 | If ANY line is LTL, order is LTL |

**Source List:** `customlist_fmt_ship_type_list`

### Shipping Methods

| Method | Internal ID | Address Type |
|--------|-------------|--------------|
| FedEx Ground | 19 | Commercial only |
| FedEx Home Delivery | 20 | Residential |

**All FedEx Method IDs:** 3, 15, 3786, 16, 3783, 17, 18, 11597, 11596, 19, 3781, 20, 8987, 3782, 14075, 22, 3785, 23, 3784

### Address Classification

| Field | Values | Notes |
|-------|--------|-------|
| `custbody_hyc_address_type` | 1 = Residential, 2 = Commercial | Custom body field |
| `shipisresidential` | true/false | Standard NS field |

---

## Active Implementations

### FedEx Integration

**Location:** `src/FileCabinet/SuiteScripts/Hycentra/Integrations/FedEX/`

| Script | Purpose |
|--------|---------|
| `getFedExRateQuote_UE.js` | Main User Event - address validation, rate quotes, ship method assignment |
| `fedexAddressValidation.js` | FedEx Address Validation API module |
| `fedexRateQuote.js` | FedEx Rate Quote API module |
| `fedexHelper.js` | Common FedEx utilities |
| `createFedExShipment.js` | Shipping label creation |
| `shippingWeightDimension.js` | Package weight/dimension calculations |

**Requirements Doc:** `FedExAddressValidation_Requirements.md`

### Address Validation Logic (Sales Order CREATE)

| Order Type | Ship Type | Ship Method | Action |
|------------|-----------|-------------|--------|
| Website | Small Parcel | Any | API validate + auto-assign FedEx Home/Ground |
| Website | LTL | Any | API validate only (no ship method change) |
| EDI | Small Parcel | Ground/Home | Skip API, force address type from ship method |
| EDI | Small Parcel | Other | No action |
| EDI | LTL | Any | API validate only |
| Other | Any | FedEx | API validate only |
| Other | Any | Non-FedEx | No action |

**Key Rule:** EDI customers assign their own shipping methods. For Small Parcel with Ground (19) or Home (20), we skip the FedEx API and force address classification to match the ship method to avoid disputes.

---

## Code Organization

```
/src/FileCabinet/SuiteScripts/
├── Hycentra/                    # Primary development folder
│   ├── Integrations/
│   │   ├── FedEX/              # FedEx shipping integration
│   │   └── FTP_SFTP/           # File transfer utilities
│   ├── ItemFulfillment/        # IF processing scripts
│   ├── SalesOrder/             # SO-related scripts
│   ├── Case/                   # Case management
│   ├── Customer/               # Customer scripts
│   ├── Item/                   # Item management
│   ├── PIM/                    # Product information
│   ├── References/             # Documentation
│   └── ...
├── FMT Consultants/            # Legacy scripts from FMT
├── Concentrus/                 # Legacy scripts
└── Logicbroker/                # Logicbroker integration
```

---

## Development Standards

### SuiteScript Version
- **Always use SuiteScript 2.1** for new development
- Use ES6 patterns: `const`, `let`, arrow functions
- AMD module pattern with `define()`

### Script Header Template
```javascript
/**
 * [script_name].js
 * [Description]
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {
    // Implementation
});
```

### Error Handling
- Wrap all operations in try-catch
- Log errors with context (record ID, operation type)
- Don't block saves on non-critical errors
- Store API responses in `custbody_shipping_api_response` for debugging

### Logging Levels
- `log.debug()` - Development/troubleshooting
- `log.audit()` - Successful business operations
- `log.error()` - Failures that need attention

---

## Custom Fields Reference

### Sales Order Body Fields

| Field ID | Type | Purpose |
|----------|------|---------|
| `custbody_hyc_address_type` | List | 1=Residential, 2=Commercial |
| `custbody_shipping_api_response` | Text | FedEx API response JSON |
| `custbody_shipping_error_message` | Text | Shipping errors |
| `custbody_fmt_actual_shipping_cost` | Currency | FedEx rate quote result |
| `otherrefnum` | Text | External order reference (WEB-* for Shopify) |

### Sales Order Line Fields

| Field ID | Type | Purpose |
|----------|------|---------|
| `custcol_fmt_ship_type` | List | 1=Small Parcel, 2=LTL |

---

## Working with This Codebase

### Before Making Changes
1. Read the relevant existing code first
2. Understand the business logic (check MD files)
3. Ask clarifying questions - don't assume
4. Challenge requirements if something seems wrong

### Testing
1. Test in sandbox first
2. Test with different order types (Website, EDI, Other)
3. Test with both Small Parcel and LTL
4. Verify API responses are logged
5. Check governance usage

### Deployment
- Scripts deploy via SuiteCloud Development Framework (SDF)
- Always update documentation when changing business logic
- Update `FedExAddressValidation_Requirements.md` for shipping logic changes

---

## Common Tasks

### Adding New EDI Customer
1. Add customer internal ID to `EDI_CUSTOMER_IDS` array in `getFedExRateQuote_UE.js`
2. Update this CLAUDE.md with customer name and ID
3. Update `FedExAddressValidation_Requirements.md`

### Adding New FedEx Shipping Method
1. Add method internal ID to `FEDEX_SHIPPING_METHOD_IDS` array
2. If it's a Ground/Home equivalent, update ship method assignment logic

### Debugging Address Validation Issues
1. Check `custbody_shipping_api_response` for API response
2. Check `custbody_shipping_error_message` for errors
3. Review script execution logs in NetSuite
4. Verify order type detection (Website/EDI/Other)
5. Check ship type (Small Parcel vs LTL)

---

## Integration Points

### Celigo
- Syncs orders from Shopify to NetSuite
- Sets `otherrefnum` with "WEB-" prefix for website orders

### Rithium (Commerce Hub), Logicbroker
- EDI integration for Home Depot, Lowe's, Wayfair
- Pre-assigns shipping methods on EDI orders

### FedEx APIs
- Address Validation API - classify residential/commercial
- Rate Quote API - get shipping costs
- Ship API - create shipping labels

---

## Agent Configuration

This workspace has a custom NetSuite expert agent:
- **Agent:** `netsuite-suitescript-expert`
- **Location:** `.claude/agents/netsuite-suitescript-expert.md`
- **Use for:** SuiteScript development, saved search formulas, workflow troubleshooting

---

## Related Resources

| Resource | Location |
|----------|----------|
| Hycentra Master Brain | `/Users/james/Documents/customers/hycentra/agent_team/CLAUDE.md` |
| NetSuite Development Guide | `AGENTS.md` (this repo) |
| FedEx Address Validation Spec | `src/.../FedEX/FedExAddressValidation_Requirements.md` |

---

## Change Log

| Date | Change |
|------|--------|
| 2025-01-12 | Initial CLAUDE.md creation |
| 2025-01-07 | FedEx Address Validation v1.3 - EDI ship method respect |
| 2025-12-26 | FedEx Address Validation v1.0 - Initial implementation |