#!/usr/bin/env bash
# =============================================================================
# agent-code — publicar o BROKER de controle remoto via HTTPS (domínio+Cloudflare)
# -----------------------------------------------------------------------------
# Caminho (multiusuário, sem senha de VPS):
#   Celular -> https://DOMINIO -> Cloudflare -> VPS:443 (Nginx)
#           -> broker (127.0.0.1:PORT) -> [WebSocket de saída] -> PC do usuário
#
# O PC de cada usuário DISCA pro broker (não precisa de túnel SSH nem senha); o
# broker roteia pelo token de cada instalação.
#
# O que este script faz (e SÓ isso):
#   - Cria UM site no Nginx (conf.d) com proxy pro broker em 127.0.0.1:PORT, já
#     com upgrade de WebSocket (o PC disca por WS) E ajustes de SSE.
#   - Se houver cert de ORIGEM da Cloudflare nos caminhos esperados, usa HTTPS na
#     origem (porta 443, p/ Cloudflare "Full (strict)"). Senão, porta 80
#     (funciona já com Cloudflare SSL "Flexible").
#   - Valida com `nginx -t` ANTES de recarregar; se ficar inválido, desfaz e aborta.
#
# NÃO instala nada, NÃO mexe no SSH, NÃO toca em outros sites do Nginx. Idempotente.
#
# Uso (como root):
#   bash vps-remote-broker.sh                         # domínio/porta padrão
#   bash vps-remote-broker.sh agent-code.larchertech.com 8099
#
# Desfazer:  rm -f /etc/nginx/conf.d/agent-code-remote.conf && nginx -t && systemctl reload nginx
# =============================================================================
set -euo pipefail

DOMAIN="${1:-agent-code.larchertech.com}"
PORT="${2:-8099}"               # porta do broker (atrás do Nginx)
CONF="/etc/nginx/conf.d/agent-code-remote.conf"
CERT_DIR="/etc/ssl/cloudflare"
CERT="${CERT_DIR}/${DOMAIN}.pem"
KEY="${CERT_DIR}/${DOMAIN}.key"

if [[ $EUID -ne 0 ]]; then echo "ERRO: rode como root (sudo)." >&2; exit 1; fi
if ! command -v nginx >/dev/null 2>&1; then
  echo "ERRO: Nginx não encontrado. Instale o Nginx antes (apt install nginx)." >&2; exit 1
fi
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
  echo "ERRO: porta inválida: $PORT" >&2; exit 1
fi

mkdir -p "$CERT_DIR"

# map (em contexto http via conf.d) p/ o header Connection do WebSocket. Nome único
# p/ não colidir com maps de outros sites.
MAP='map $http_upgrade $agentcode_conn_upgrade { default upgrade; "" close; }'

# bloco de proxy reutilizado: WebSocket (relay do PC) + SSE
read -r -d '' PROXY <<EOF || true
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # WebSocket de saída do PC + SSE: upgrade e sem buffer/timeout curto
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$agentcode_conn_upgrade;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        chunked_transfer_encoding off;
    }
EOF

MODE=""
if [[ -s "$CERT" && -s "$KEY" ]]; then
  MODE="https"
  # Atrás da Cloudflare a origem NÃO redireciona (um 301 na :80 quebra o WebSocket
  # e cria loop). As duas portas proxiam pro broker; quem força HTTPS é a Cloudflare.
  cat > "$CONF" <<EOF
# agent-code broker — gerado por vps-remote-broker.sh ($(date -u +%FT%TZ))
${MAP}
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    client_max_body_size 25m;
${PROXY}
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${DOMAIN};
    ssl_certificate     ${CERT};
    ssl_certificate_key ${KEY};
    client_max_body_size 25m;
${PROXY}
}
EOF
else
  MODE="http"
  cat > "$CONF" <<EOF
# agent-code broker — gerado por vps-remote-broker.sh ($(date -u +%FT%TZ))
# Sem cert de origem ainda → porta 80 (use Cloudflare SSL = "Flexible").
${MAP}
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    client_max_body_size 25m;
${PROXY}
}
EOF
fi

# valida ANTES de aplicar; se inválido, remove e aborta
if ! nginx -t 2>/tmp/nginx_test.err; then
  echo "ERRO: configuração do Nginx ficou inválida — DESFAZENDO e abortando:" >&2
  cat /tmp/nginx_test.err >&2
  rm -f "$CONF"
  exit 1
fi
systemctl reload nginx
echo "==> Nginx OK. Site '${DOMAIN}' → broker 127.0.0.1:${PORT} (modo: ${MODE^^})."
echo

cat <<EOF
SUBA O BROKER (na VPS, pasta broker/ do projeto):
    cd broker && docker compose down && docker compose up -d --build
(ele fica em 127.0.0.1:${PORT}; só o Nginx fala com ele)

EOF

if [[ "$MODE" == "http" ]]; then
  cat <<EOF
PARA HTTPS PONTA-A-PONTA (recomendado), uma vez:
  1) Cloudflare → SSL/TLS → Origin Server → Create Certificate (padrão).
  2) Salve o conteúdo em:
       ${CERT}   (certificado)
       ${KEY}    (chave privada)
  3) Cloudflare → SSL/TLS → "Full (strict)".
  4) Rode este script de novo (detecta o cert e vira HTTPS 443).
  (Por enquanto, Cloudflare SSL = "Flexible" já funciona via porta 80.)

EOF
fi

cat <<EOF
CLOUDFLARE: o registro de ${DOMAIN} deve apontar (A) pra VPS e estar PROXIADO (laranja).

NO APP (cada usuário, qualquer máquina): só abrir e clicar "Ligar ponte" 📱. O PC
disca sozinho pro broker — SEM túnel SSH, SEM senha de VPS. O QR já aponta pra
https://${DOMAIN} e o acesso é roteado pelo token de cada instalação.

Desfazer este site:  rm -f ${CONF} && nginx -t && systemctl reload nginx
EOF
