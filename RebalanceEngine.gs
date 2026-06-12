/**
 * RebalanceEngine.gs
 * 負責判斷是否需要再平衡 (每月檢查)
 */
var RebalanceEngine = {
  shouldRebalance: function(date, nextDate, currentWeights, targetWeights) {
    // 檢查是否月底
    var isMonthEnd = false;
    if (!nextDate) isMonthEnd = true;
    else if (nextDate.getMonth() !== date.getMonth()) isMonthEnd = true;
    
    if (!isMonthEnd) return false;
    
    // 計算換手率
    var turnover = 0;
    Constants.TICKERS.forEach(function(t) {
      turnover += Math.abs(targetWeights[t] - currentWeights[t]);
    });
    turnover /= 2;
    
    // 若換手率 <= 10% 且無危機/跳空 (此函數僅在正常模式調用)，則跳過
    if (turnover <= 0.10) return false;
    
    return true;
  }
};
