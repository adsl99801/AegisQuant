/**
 * PortfolioManager.gs
 * 管理投資組合狀態 (現金、持倉、淨值)
 */
var PortfolioManager = {
  create: function() {
    var p = {
      cash: Constants.INITIAL_CAPITAL,
      holdings: {},
      avgCosts: {},
      equityCurve: [],
      peakValue: Constants.INITIAL_CAPITAL,
      
      // 更新並取得當前總資產
      updateValue: function(prices) {
        var value = this.cash;
        for (var ticker in this.holdings) {
          if (prices[ticker]) {
            value += this.holdings[ticker] * prices[ticker].close;
          }
        }
        if (value > this.peakValue) this.peakValue = value;
        return value;
      },
      
      getDrawdown: function(currentValue) {
        return (this.peakValue - currentValue) / this.peakValue;
      },
      
      // 取得當前持倉權重 (用於 Gap 計算)
      getCurrentWeights: function(currentValue, prices) {
        var w = {};
        for (var ticker in this.holdings) {
          var val = this.holdings[ticker] * (prices[ticker] ? prices[ticker].close : 0);
          w[ticker] = currentValue > 0 ? val / currentValue : 0;
        }
        return w;
      },
      
      // 取得當前持倉的總成本
      getTotalCost: function() {
        var totalCost = this.cash;
        for (var ticker in this.holdings) {
          totalCost += this.holdings[ticker] * (this.avgCosts[ticker] || 0);
        }
        return totalCost;
      }
    };
    
    Constants.TICKERS.forEach(function(t) {
      p.holdings[t] = 0;
      p.avgCosts[t] = 0;
    });
    
    return p;
  }
};
