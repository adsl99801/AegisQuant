/**
 * Constants.gs
 * 系統參數設定
 */
var Constants = {
  INITIAL_CAPITAL: 10000,
  TICKERS: ['SPMO', 'XLE', 'VDC', 'VCR'],
  BENCHMARK: 'SPY',
  VIX: '^VIX',
  RISK_FREE_RATE: 0.02,
  START_DATE: '2010-06-29',
  END_DATE: new Date().toISOString().split('T')[0],
  
  // Base Weights (Normal State)
  BASE_WEIGHTS: { 
    SPMO: 0.60, 
    XLE: 0.10, 
    VDC: 0.10, 
    VCR: 0.20
  },
  // Max Weight Caps (Upper Limit for Buying/rebalance)
  MAX_WEIGHTS: {
    SPMO: 1.00,  // No Limit
    XLE: 0.30, 
    VDC: 0.30, 
    VCR: 0.30
  },
  // Crisis Configuration
  CRISIS_CONFIG: {
    VIX_THRESHOLD: 25,
    MDD_THRESHOLD: 0.07, // 7%
    EXIT_VIX: 20,
    EXIT_MDD: 0.05,      // 5% (Deprecated / Ignored in new logic)
    WAIT_DAYS: 3,        // 3 Days (VIX < 20 + SPY Non-Lower Low) 
    WEIGHTS: { SPMO: 0, XLE: 0, VDC: 0, VCR: 0 } // Pure Cash Defense
  },

  // Constraints
  CONSTRAINTS: {
    MA_TREND_DAYS: 100,       // 100 MA Filter
    GAP_UP_MULTIPLIER: 1.005, // Open > PrevHigh * 1.005
    COST_SKIP_TURNOVER: 0.10, // 10% Turnover Threshold
    SCORE_BONUS: 0.10,        // +10% (Increased from 5%)
    SCORE_BONUS: 0.10,        // +10% (Increased from 5%)
    TREASURY_RATE_THRESHOLD: 0.03, // 3%
    DRIFT_THRESHOLD: 0.15     // 15% Drift Threshold
  },
  
  // Transaction Costs
  COST_CONFIG: {
    MIN_PER_ORDER: 1.0,      // Minimum $1 per order
    PER_SHARE: 0.0035,       // $0.0035 per share
    REBALANCE_TAX_RATE: 0.001 // 0.1% Tax/Slippage on Turnover Value
  },
  
  // Notification
  NOTIFICATION_EMAIL: 'adsl99801@gmail.com',
  NOTIFY_ONLY_ON_OPERATION: true
};
