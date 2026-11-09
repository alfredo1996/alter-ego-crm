/**
 * The VAT rate an Italian invoice carries. No tax calculation lives here any more:
 * taxes are the accountant's job. The euro formatters moved to @alter-ego/kernel/currency.
 */

/** IVA (Value Added Tax): the standard rate, what an invoice adds on top of its net amount. */
export const IVA_RATE = 0.22
