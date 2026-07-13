import { chromium } from 'playwright';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setViewportSize({ width: 1600, height: 900 });
  await p.goto('http://localhost:5173/panel/inventory');
  await p.waitForTimeout(5000);

  // Click ACTIVE button to ensure we're in Active mode
  const activeBtn = await p.$('button:has-text("Active")');
  if (activeBtn) await activeBtn.click();
  await p.waitForTimeout(2000);

  // Analyze DOM alignment
  const result = await p.evaluate(() => {
    const ths = document.querySelectorAll('thead tr th');
    const thInfo = Array.from(ths).map((th, i) => {
      const rect = th.getBoundingClientRect();
      return { i, label: th.textContent?.trim().substring(0, 25) || '(empty)', left: Math.round(rect.left), width: Math.round(rect.width) };
    });
    const firstRow = document.querySelector('tbody tr');
    const tds = firstRow ? firstRow.querySelectorAll('td') : [];
    const tdInfo = Array.from(tds).map((td, i) => {
      const rect = td.getBoundingClientRect();
      return { i, content: td.textContent?.trim().substring(0, 40) || '(empty)', left: Math.round(rect.left), width: Math.round(rect.width) };
    });
    return { thCount: ths.length, tdCount: tds.length, headers: thInfo, cells: tdInfo };
  });

  console.log('=== HEADER vs CELL ALIGNMENT ===');
  console.log('TH count:', result.thCount, '| TD count:', result.tdCount);
  console.log('');
  const maxCols = Math.max(result.headers.length, result.cells.length);
  for (let i = 0; i < maxCols; i++) {
    const th = result.headers[i];
    const td = result.cells[i];
    const match = th && td && th.left === td.left && th.width === td.width ? 'OK' : 'MISMATCH';
    console.log(`Col ${i}: TH[${th?.label || 'NONE'}] left=${th?.left} w=${th?.width}  |  TD[${td?.content?.substring(0,25) || 'NONE'}] left=${td?.left} w=${td?.width}  => ${match}`);
  }

  await p.screenshot({ path: 'inv_debug.png' });
  await b.close();
})();
