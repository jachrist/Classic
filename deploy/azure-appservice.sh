#!/usr/bin/env bash
# Deploy Classic til Azure App Service (Linux, Node). Idempotent — kan kjøres på nytt
# for å oppdatere. Krever at 'az' er installert og at du har kjørt 'az login'.
#
# Bruk:
#   APP_NAME=classic-mittnavn ./deploy/azure-appservice.sh
#
# Valgfrie variabler (med standardverdier):
#   RESOURCE_GROUP=classic-rg  PLAN=classic-plan  LOCATION=westeurope  SKU=F1
set -euo pipefail

APP_NAME="${APP_NAME:?Sett APP_NAME til et globalt unikt navn, f.eks. classic-utsikten}"
RESOURCE_GROUP="${RESOURCE_GROUP:-classic-rg}"
PLAN="${PLAN:-classic-plan}"
LOCATION="${LOCATION:-westeurope}"
SKU="${SKU:-F1}"

# Kjør fra repo-rota (der package.json med start-script ligger)
cd "$(dirname "$0")/.."

echo "▶ Deployer $APP_NAME (rg=$RESOURCE_GROUP, sku=$SKU, $LOCATION)…"
az webapp up \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$PLAN" \
  --runtime "NODE:22-lts" \
  --sku "$SKU" \
  --location "$LOCATION" \
  --os-type Linux

echo "▶ Setter miljøvariabler…"
az webapp config appsettings set \
  --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --settings \
    FRONTEND_DIR=./frontend \
    SQLITE_DB_PATH=/home/data/classic.db \
    SQLITE_JOURNAL_MODE=DELETE \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true \
  --output none

az webapp config set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --startup-file "npm start" --output none

echo "▶ Restarter…"
az webapp restart --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --output none

echo "✅ Ferdig! Åpne: https://$APP_NAME.azurewebsites.net"
