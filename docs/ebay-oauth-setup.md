# eBay Connect (Authorization Code + refresh token ~18 months)
# Already used for Browse API app tokens:
# EBAY_CLIENT_ID=
# EBAY_CLIENT_SECRET=
# EBAY_MARKETPLACE_ID=EBAY_DE
#
# Required for Connect eBay button:
# EBAY_RUNAME=Your-RuName-From-Developer-Portal
# Optional: EBAY_ENV=production | sandbox
#
# In eBay Developer Portal → Your Keyset → User Tokens → Get a Token from eBay via Your Application:
# create/edit an RuName whose Accept URL is:
#   https://YOUR_PRODUCTION_DOMAIN/auth/ebay/callback
# (for local Vite, use a second RuName pointing at http://localhost:5173/auth/ebay/callback)
