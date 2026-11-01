"""Exercise real PIN forms; no production bypass is used."""
PIN='123456'
def enter_pin(page,value=PIN):
 page.wait_for_selector('#pinEntry:visible')
 page.fill('#pinEntry',value)
 page.click('#pinAccept')
def unlock_app(page):
 page.wait_for_selector('#pinEntry:visible')
 heading=page.locator('.pin-card h2').inner_text()
 if heading=='Crea tu PIN':
  enter_pin(page)
  page.wait_for_function("document.querySelector('.pin-card h2')?.textContent==='Repite tu PIN'")
  enter_pin(page)
 else:enter_pin(page)
 page.wait_for_function('securityUnlocked && !pinPromptOpen')
def confirm_action(page,value=PIN):
 enter_pin(page,value)
 page.wait_for_function('!pinPromptOpen')
