#!/usr/bin/env bash
#
# REBOOT CLUB — Installation et deploiement du backend Django sur un VPS.
#
# Deploiement classique (sans Docker) : PostgreSQL + Gunicorn + systemd + Nginx.
#
# CONCU POUR UN SERVEUR PARTAGE : le script ne touche jamais aux autres
# applications deja deployees. Il utilise un utilisateur systeme dedie, une base
# de donnees dediee, un socket Unix (donc aucun conflit de port), un service
# systemd nomme et un seul fichier de site Nginx. Il refuse de continuer si un
# nom identique existe deja.
#
# Usage :  sudo bash install.sh
#
set -euo pipefail

# ---------------------------------------------------------------- apparence
if [[ -t 1 ]]; then
    BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'
    YELLOW=$'\e[33m'; BLUE=$'\e[36m'; RESET=$'\e[0m'
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi
step()  { printf "\n%s==> %s%s\n" "$BOLD$BLUE" "$*" "$RESET"; }
ok()    { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$*"; }
warn()  { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$*"; }
info()  { printf "  %s·%s %s\n" "$DIM" "$RESET" "$*"; }
die()   { printf "\n%sERREUR :%s %s\n\n" "$BOLD$RED" "$RESET" "$*" >&2; exit 1; }

on_error() { die "Interruption a la ligne ${1}. Les autres applications du serveur n'ont pas ete modifiees."; }
trap 'on_error $LINENO' ERR

# ---------------------------------------------------------------- questions
ask() {                      # ask VARIABLE "Question" "defaut"
    local __var="$1" __question="$2" __default="${3:-}" __reply=""
    while true; do
        if [[ -n "$__default" ]]; then
            read -r -p "  ${__question} [${__default}] : " __reply || true
            __reply="${__reply:-$__default}"
        else
            read -r -p "  ${__question} : " __reply || true
        fi
        [[ -n "$__reply" ]] && break
        warn "Cette reponse est obligatoire."
    done
    printf -v "$__var" '%s' "$__reply"
}

ask_secret() {               # ask_secret VARIABLE "Question"  (saisie masquee)
    local __var="$1" __question="$2" __reply="" __confirm=""
    while true; do
        read -r -s -p "  ${__question} : " __reply || true; echo
        [[ -z "$__reply" ]] && { warn "Cette reponse est obligatoire."; continue; }
        read -r -s -p "  Confirmez : " __confirm || true; echo
        [[ "$__reply" == "$__confirm" ]] && break
        warn "Les deux saisies different."
    done
    printf -v "$__var" '%s' "$__reply"
}

ask_optional_secret() {      # jeton facultatif (depot public)
    local __var="$1" __question="$2" __reply=""
    read -r -s -p "  ${__question} : " __reply || true; echo
    printf -v "$__var" '%s' "$__reply"
}

confirm() {                  # confirm "Question" "o"|"n"
    local __question="$1" __default="${2:-o}" __reply=""
    local __hint="[O/n]"; [[ "$__default" == "n" ]] && __hint="[o/N]"
    read -r -p "  ${__question} ${__hint} : " __reply || true
    __reply="${__reply:-$__default}"
    [[ "$__reply" =~ ^[oOyY] ]]
}

# ---------------------------------------------------------------- preflight
step "Verifications prealables"
[[ $EUID -eq 0 ]] || die "Lancez ce script avec sudo : sudo bash install.sh"
command -v apt-get >/dev/null || die "Ce script cible Debian/Ubuntu (apt-get introuvable)."
ok "Systeme Debian/Ubuntu detecte, execution en root"

if [[ -d /etc/nginx/sites-enabled ]]; then
    EXISTING=$(find /etc/nginx/sites-enabled -type l -o -type f | wc -l)
    info "Nginx est deja installe avec ${EXISTING} site(s) actif(s) : ils seront preserves"
fi

cat <<BANNER

${BOLD}REBOOT CLUB — installation du backend${RESET}
${DIM}Repondez aux questions ci-dessous. Rien n'est ecrit sur le serveur
avant le recapitulatif et votre confirmation finale.${RESET}
BANNER

# ---------------------------------------------------------------- collecte
step "Identite de l'application"
ask APP_SLUG        "Nom technique de l'application (lettres, chiffres, tirets)" "reboot-club"
[[ "$APP_SLUG" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || die "Nom technique invalide : minuscules, chiffres et tirets, 2 a 31 caracteres."

APP_USER="$APP_SLUG"
DATA_DIR="/var/lib/${APP_SLUG}"
LOG_DIR="/var/log/${APP_SLUG}"
CONF_DIR="/etc/${APP_SLUG}"
SERVICE="${APP_SLUG}.service"
NGINX_SITE="/etc/nginx/sites-available/${APP_SLUG}.conf"

# Reprise possible d'une installation precedente ou interrompue.
if [[ -f "${CONF_DIR}/deploy.conf" ]]; then
    warn "Installation existante detectee : elle sera mise a jour en place."
elif [[ -e "$NGINX_SITE" ]]; then
    # Seul cas reellement dangereux : un site Nginx homonyme appartenant a une
    # autre application. On refuse pour ne pas la casser.
    die "Un site Nginx nomme '${APP_SLUG}.conf' existe deja et n'a pas ete cree par ce script. Choisissez un autre nom technique."
fi

step "Serveur et domaine"
DEFAULT_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
ask SERVER_IP       "Adresse IP publique du serveur" "${DEFAULT_IP:-}"
ask DOMAIN          "Nom de domaine de l'API (ex. api.reboot.cd)"
[[ "$DOMAIN" =~ ^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || die "Nom de domaine invalide."

# Conflit de server_name avec une autre application deja deployee ?
if [[ -d /etc/nginx ]] && grep -rIlsE "server_name[^;]*[[:space:]]${DOMAIN}[;[:space:]]" /etc/nginx/sites-enabled 2>/dev/null \
        | grep -qv "${APP_SLUG}.conf"; then
    die "Le domaine ${DOMAIN} est deja servi par un autre site Nginx. Choisissez un autre sous-domaine."
fi

USE_HTTPS=false
LETSENCRYPT_EMAIL=""
if confirm "Activer HTTPS automatiquement avec Let's Encrypt (recommande)" "o"; then
    USE_HTTPS=true
    ask LETSENCRYPT_EMAIL "Adresse e-mail pour les alertes de certificat"
fi

step "Code source"
ask APP_DIR "Dossier du code sur le serveur" "/opt/${APP_SLUG}"
[[ "$APP_DIR" = /* ]] || die "Indiquez un chemin absolu."

# Un depot deja clone est reutilise tel quel : on lit son origine et sa branche
# pour les proposer par defaut.
EXISTING_REPO=false
DETECTED_URL=""; DETECTED_BRANCH="main"
if [[ -d "${APP_DIR}/.git" ]]; then
    EXISTING_REPO=true
    DETECTED_URL="$(git -C "$APP_DIR" remote get-url origin 2>/dev/null || true)"
    DETECTED_BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    # Un depot sans aucun commit renvoie "HEAD" : sans interet comme defaut.
    [[ -z "$DETECTED_BRANCH" || "$DETECTED_BRANCH" == "HEAD" ]] && DETECTED_BRANCH="main"
    # Une URL contenant deja un jeton ne doit pas etre reaffichee en clair.
    [[ "$DETECTED_URL" == *"@"* ]] && DETECTED_URL="$(printf '%s' "$DETECTED_URL" | sed -E 's#https://[^@]*@#https://#')"
    ok "Depot Git deja present : ${DETECTED_URL:-origine inconnue} (branche ${DETECTED_BRANCH})"
elif [[ -d "$APP_DIR" ]]; then
    LEFTOVER="$(find "$APP_DIR" -mindepth 1 -maxdepth 1 \
        ! -name '.bashrc' ! -name '.profile' ! -name '.bash_logout' \
        ! -name '.bash_history' ! -name '.cache' ! -name '.local' \
        ! -name '.gitconfig' ! -name '.git-credentials' 2>/dev/null | wc -l)"
    if [[ "${LEFTOVER:-0}" -eq 0 ]]; then
        info "Dossier ${APP_DIR} present mais vide : le code y sera recupere"
    else
        warn "Le dossier ${APP_DIR} contient des fichiers sans depot Git."
        confirm "Y initialiser le depot et y synchroniser le code" "n" \
            || die "Installation annulee. Indiquez un autre dossier."
    fi
fi

ask GIT_URL "URL HTTPS du depot" "${DETECTED_URL}"
[[ "$GIT_URL" =~ ^https://github\.com/.+ ]] || die "Utilisez une URL HTTPS github.com (pas SSH)."
ask GIT_BRANCH "Branche a deployer" "${DETECTED_BRANCH}"
GIT_TOKEN=""
if confirm "Le depot est-il prive (jeton d'acces personnel requis)" "o"; then
    ask_optional_secret GIT_TOKEN "Jeton d'acces GitHub (ghp_... — saisie masquee)"
    [[ -n "$GIT_TOKEN" ]] || die "Un jeton est necessaire pour un depot prive."
fi
ask BACKEND_SUBDIR "Sous-dossier du backend dans le depot" "backend"

SYNC_CODE=true
if [[ "$EXISTING_REPO" == true ]]; then
    warn "La synchronisation execute 'git reset --hard' : toute modification locale non commitee sera perdue."
    confirm "Synchroniser ${APP_DIR} sur origin/${GIT_BRANCH} maintenant" "o" || SYNC_CODE=false
    if [[ "$SYNC_CODE" == false && ! -f "${APP_DIR}/${BACKEND_SUBDIR}/manage.py" ]]; then
        die "manage.py introuvable dans ${APP_DIR}/${BACKEND_SUBDIR}. Verifiez le sous-dossier du backend."
    fi
fi

step "Base de donnees PostgreSQL"
ask DB_NAME         "Nom de la base" "${APP_SLUG//-/_}"
ask DB_USER         "Utilisateur de la base" "${APP_SLUG//-/_}"
[[ "$DB_NAME" =~ ^[a-z_][a-z0-9_]*$ ]] || die "Nom de base invalide (minuscules, chiffres, underscore)."
[[ "$DB_USER" =~ ^[a-z_][a-z0-9_]*$ ]] || die "Nom d'utilisateur de base invalide."
ask_secret DB_PASSWORD "Mot de passe de la base (saisie masquee)"

step "Compte administrateur de l'application"
CREATE_ADMIN=false
ADMIN_PHONE=""; ADMIN_EMAIL=""; ADMIN_FIRST=""; ADMIN_LAST=""; ADMIN_PASSWORD=""
if confirm "Creer un compte administrateur REBOOT CLUB maintenant" "o"; then
    CREATE_ADMIN=true
    ask ADMIN_PHONE     "Telephone au format international (ex. +243810000001)"
    ask ADMIN_EMAIL     "E-mail de l'administrateur"
    ask ADMIN_FIRST     "Prenom"
    ask ADMIN_LAST      "Nom"
    ask_secret ADMIN_PASSWORD "Mot de passe de l'administrateur (saisie masquee)"
fi

step "Options"
ask GUNICORN_WORKERS "Nombre de workers Gunicorn" "$(( $(nproc 2>/dev/null || echo 1) * 2 + 1 ))"
ask MOBILE_ORIGINS   "Origines autorisees pour le mobile/web (separees par des virgules)" "https://${DOMAIN}"
SEED_DEMO=false
confirm "Charger le jeu de donnees de demonstration (a eviter en production)" "n" && SEED_DEMO=true

# ---------------------------------------------------------------- resume
cat <<RESUME

${BOLD}Recapitulatif${RESET}
  Application ........ ${APP_SLUG}
  Dossier du code .... ${APP_DIR} $([[ "$EXISTING_REPO" == true ]] && echo "(depot existant reutilise)" || echo "(recupere depuis GitHub)")
                       ${DATA_DIR}  (media, fichiers statiques, sauvegardes)
  Utilisateur systeme  ${APP_USER}
  Domaine ............ ${DOMAIN}  (IP ${SERVER_IP})
  HTTPS .............. $([[ "$USE_HTTPS" == true ]] && echo "oui, Let's Encrypt" || echo "non — HTTP seulement")
  Depot .............. ${GIT_URL} (branche ${GIT_BRANCH})
  Synchronisation .... $([[ "$SYNC_CODE" == true ]] && echo "oui, git reset --hard sur origin/${GIT_BRANCH}" || echo "non, code laisse en l'etat")
  Jeton GitHub ....... $([[ -n "$GIT_TOKEN" ]] && echo "fourni, stocke en 0600" || echo "aucun (depot public)")
  Base de donnees .... ${DB_NAME} / ${DB_USER}
  Service systemd .... ${SERVICE}
  Site Nginx ......... ${NGINX_SITE}
  Workers Gunicorn ... ${GUNICORN_WORKERS}
  Compte admin ....... $([[ "$CREATE_ADMIN" == true ]] && echo "$ADMIN_PHONE" || echo "aucun")
  Donnees de demo .... $([[ "$SEED_DEMO" == true ]] && echo "oui" || echo "non")

RESUME
confirm "Lancer l'installation avec ces parametres" "o" || die "Installation annulee. Rien n'a ete modifie."

# ---------------------------------------------------------------- paquets
step "Installation des paquets systeme manquants"
NEEDED=()
for pkg in git curl ca-certificates python3 python3-venv python3-dev build-essential libpq-dev postgresql postgresql-client nginx; do
    dpkg -s "$pkg" >/dev/null 2>&1 || NEEDED+=("$pkg")
done
if [[ "$USE_HTTPS" == true ]]; then
    dpkg -s certbot >/dev/null 2>&1 || NEEDED+=(certbot)
    dpkg -s python3-certbot-nginx >/dev/null 2>&1 || NEEDED+=(python3-certbot-nginx)
fi
if ((${#NEEDED[@]})); then
    info "A installer : ${NEEDED[*]}"
    export DEBIAN_FRONTEND=noninteractive
    # needrestart est neutralise : sur un serveur partage il proposerait de
    # redemarrer docker.service, ssh ou dbus, ce qui couperait les autres
    # applications. Les redemarrages restent a votre main.
    export NEEDRESTART_SUSPEND=1
    export NEEDRESTART_MODE=l
    apt-get update -qq
    apt-get install -y -qq "${NEEDED[@]}"
    ok "Paquets installes (aucun service tiers redemarre)"
else
    ok "Tous les paquets requis sont deja presents"
fi
systemctl enable --now postgresql >/dev/null 2>&1 || true
systemctl enable --now nginx >/dev/null 2>&1 || true

# ---------------------------------------------------------------- utilisateur
step "Utilisateur systeme et arborescence"
mkdir -p "$DATA_DIR"
# Le dossier personnel du compte est DATA_DIR et non APP_DIR : sinon adduser y
# depose ses fichiers de squelette et le clonage du depot devient impossible.
if ! id -u "$APP_USER" >/dev/null 2>&1; then
    adduser --system --group --home "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
    ok "Utilisateur systeme ${APP_USER} cree (sans shell de connexion)"
else
    CURRENT_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
    if [[ "$CURRENT_HOME" != "$DATA_DIR" ]]; then
        usermod -d "$DATA_DIR" "$APP_USER"
        # Fichiers de squelette laisses par une execution precedente.
        rm -f "${APP_DIR}/.bashrc" "${APP_DIR}/.profile" "${APP_DIR}/.bash_logout" 2>/dev/null || true
        ok "Utilisateur ${APP_USER} deja present : dossier personnel corrige vers ${DATA_DIR}"
    else
        ok "Utilisateur systeme ${APP_USER} deja present"
    fi
fi
mkdir -p "$APP_DIR" "$DATA_DIR/media" "$DATA_DIR/staticfiles" "$DATA_DIR/backups" "$LOG_DIR" "$CONF_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR" "$LOG_DIR"
chmod 750 "$APP_DIR" "$DATA_DIR" "$LOG_DIR"
chmod 700 "$CONF_DIR"
ok "Arborescence prete"

# ---------------------------------------------------------------- postgres
step "Base de donnees PostgreSQL"
psql_root() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qtAX -c "$1"; }
ESCAPED_PASSWORD="${DB_PASSWORD//\'/\'\'}"
if [[ "$(psql_root "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")" == "1" ]]; then
    psql_root "ALTER ROLE \"${DB_USER}\" WITH LOGIN PASSWORD '${ESCAPED_PASSWORD}'" >/dev/null
    ok "Role ${DB_USER} existant : mot de passe mis a jour"
else
    psql_root "CREATE ROLE \"${DB_USER}\" WITH LOGIN PASSWORD '${ESCAPED_PASSWORD}'" >/dev/null
    ok "Role ${DB_USER} cree"
fi
if [[ "$(psql_root "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")" == "1" ]]; then
    ok "Base ${DB_NAME} deja presente : conservee telle quelle"
else
    sudo -u postgres createdb -O "$DB_USER" -E UTF8 "$DB_NAME"
    ok "Base ${DB_NAME} creee"
fi
psql_root "GRANT ALL PRIVILEGES ON DATABASE \"${DB_NAME}\" TO \"${DB_USER}\"" >/dev/null
sudo -u postgres psql -v ON_ERROR_STOP=1 -qtAX -d "$DB_NAME" \
    -c "GRANT ALL ON SCHEMA public TO \"${DB_USER}\"; ALTER SCHEMA public OWNER TO \"${DB_USER}\";" >/dev/null
ok "Droits accordes a ${DB_USER}"

# ---------------------------------------------------------------- depot git
step "Preparation du code source"
if [[ -n "$GIT_TOKEN" ]]; then
    # Le jeton n'est jamais inscrit dans l'URL du remote : il vit dans un
    # fichier d'identifiants lisible par le seul utilisateur de l'application.
    GIT_HOST="$(printf '%s' "$GIT_URL" | sed -E 's#^https://([^/]+)/.*#\1#')"
    umask 077
    printf 'https://x-access-token:%s@%s\n' "$GIT_TOKEN" "$GIT_HOST" > "${CONF_DIR}/git-credentials"
    chown "$APP_USER:$APP_USER" "${CONF_DIR}/git-credentials"
    chmod 600 "${CONF_DIR}/git-credentials"
    umask 022
    ok "Jeton GitHub enregistre dans ${CONF_DIR}/git-credentials (0600)"
fi

run_as_app() { sudo -u "$APP_USER" -H env HOME="$DATA_DIR" "$@"; }

mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
ok "Dossier ${APP_DIR} attribue a ${APP_USER}"

git config --system --add safe.directory "$APP_DIR" 2>/dev/null || true
if [[ -n "$GIT_TOKEN" ]]; then
    run_as_app git config --global credential.helper "store --file=${CONF_DIR}/git-credentials"
fi
run_as_app git config --global --add safe.directory "$APP_DIR"

# Depot initialise SUR PLACE plutot que clone : `git clone` refuse un dossier
# non vide, ce qui empeche de reutiliser un code deja present.
if [[ ! -d "${APP_DIR}/.git" ]]; then
    run_as_app git init -q "$APP_DIR"
    ok "Depot initialise dans ${APP_DIR}"
fi
if run_as_app git -C "$APP_DIR" remote get-url origin >/dev/null 2>&1; then
    run_as_app git -C "$APP_DIR" remote set-url origin "$GIT_URL"
else
    run_as_app git -C "$APP_DIR" remote add origin "$GIT_URL"
fi

if [[ "$SYNC_CODE" == true ]]; then
    run_as_app git -C "$APP_DIR" fetch --prune origin \
        || die "Recuperation du depot impossible. Verifiez l'URL, la branche et le jeton d'acces GitHub."
    run_as_app git -C "$APP_DIR" rev-parse --verify --quiet "origin/${GIT_BRANCH}" >/dev/null \
        || die "La branche '${GIT_BRANCH}' n'existe pas sur ${GIT_URL}."
    run_as_app git -C "$APP_DIR" checkout -B "$GIT_BRANCH" "origin/${GIT_BRANCH}"
    run_as_app git -C "$APP_DIR" reset --hard "origin/${GIT_BRANCH}"
    ok "Code synchronise sur la branche ${GIT_BRANCH}"
else
    ok "Code laisse en l'etat, aucune synchronisation demandee"
fi

BACKEND_DIR="${APP_DIR}/${BACKEND_SUBDIR}"
[[ -f "${BACKEND_DIR}/manage.py" ]] || die "manage.py introuvable dans ${BACKEND_DIR}. Verifiez le sous-dossier du backend."
COMMIT="$(run_as_app git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo "inconnu")"
ok "Version deployee : ${COMMIT}"

# ---------------------------------------------------------------- python
step "Environnement Python"
VENV="${DATA_DIR}/venv"
if [[ ! -x "${VENV}/bin/python" ]]; then
    run_as_app python3 -m venv "$VENV"
    ok "Environnement virtuel cree dans ${VENV}"
fi
run_as_app "${VENV}/bin/pip" install --quiet --upgrade pip wheel setuptools
run_as_app "${VENV}/bin/pip" install --quiet -r "${BACKEND_DIR}/requirements.txt"
run_as_app "${VENV}/bin/pip" install --quiet gunicorn
ok "Dependances installees"

# ---------------------------------------------------------------- configuration
step "Configuration de l'application"
# Reglages de production hors depot : ils survivent a tous les git pull.
SETTINGS_PROD="${BACKEND_DIR}/config/settings_prod.py"

write_settings_prod() {   # write_settings_prod true|false  (HTTPS actif ?)
    local https_on="$1"
    cat > "$SETTINGS_PROD" <<PYEOF
"""Reglages de production — genere par install.sh, hors depot Git.

Les fichiers televerses et les fichiers statiques vivent en dehors du depot
pour ne jamais etre effaces par une mise a jour du code.
"""
from config.settings import *  # noqa: F401,F403

MEDIA_ROOT = "${DATA_DIR}/media"
STATIC_ROOT = "${DATA_DIR}/staticfiles"

# Nginx effectue deja la redirection ; ce reglage protege les appels directs.
SECURE_SSL_REDIRECT = ${https_on}
SECURE_HSTS_SECONDS = $([[ "$https_on" == "True" ]] && echo 31536000 || echo 0)
SECURE_HSTS_INCLUDE_SUBDOMAINS = ${https_on}
SECURE_HSTS_PRELOAD = ${https_on}
SESSION_COOKIE_SECURE = ${https_on}
CSRF_COOKIE_SECURE = ${https_on}
CSRF_TRUSTED_ORIGINS = ["https://${DOMAIN}", "http://${DOMAIN}"]
PYEOF
    chown "$APP_USER:$APP_USER" "$SETTINGS_PROD"
}

# Les reglages HTTPS sont reecrits apres l'obtention effective du certificat.
write_settings_prod "$([[ "$USE_HTTPS" == true ]] && echo True || echo False)"

if [[ -f "${BACKEND_DIR}/.env" ]]; then
    SECRET_KEY="$(grep -E '^SECRET_KEY=' "${BACKEND_DIR}/.env" | cut -d= -f2- || true)"
fi
[[ -n "${SECRET_KEY:-}" ]] || SECRET_KEY="$(python3 -c 'import secrets;print(secrets.token_urlsafe(64))')"

umask 077
cat > "${BACKEND_DIR}/.env" <<ENVEOF
# Genere par install.sh — ne pas versionner.
SECRET_KEY=${SECRET_KEY}
DEBUG=false
ALLOWED_HOSTS=${DOMAIN},${SERVER_IP},127.0.0.1,localhost
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}
CORS_ALLOWED_ORIGINS=${MOBILE_ORIGINS}
DJANGO_SETTINGS_MODULE=config.settings_prod
ENVEOF
umask 022
chown "$APP_USER:$APP_USER" "${BACKEND_DIR}/.env"
chmod 600 "${BACKEND_DIR}/.env"
ok "Fichier .env ecrit (0600)"

# Reprise des fichiers deja televerses s'ils se trouvaient dans le depot.
if [[ -d "${BACKEND_DIR}/media" && ! -L "${BACKEND_DIR}/media" ]]; then
    if [[ -n "$(ls -A "${BACKEND_DIR}/media" 2>/dev/null)" ]]; then
        cp -an "${BACKEND_DIR}/media/." "${DATA_DIR}/media/" 2>/dev/null || true
        ok "Fichiers media du depot recopies vers ${DATA_DIR}/media"
    fi
fi
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"

manage() { run_as_app env DJANGO_SETTINGS_MODULE=config.settings_prod \
    "${VENV}/bin/python" "${BACKEND_DIR}/manage.py" "$@"; }

step "Base de donnees : migrations et fichiers statiques"
manage migrate --noinput
ok "Migrations appliquees"
manage collectstatic --noinput --clear >/dev/null
ok "Fichiers statiques collectes dans ${DATA_DIR}/staticfiles"
manage check --deploy 2>&1 | sed 's/^/    /' || true

if [[ "$CREATE_ADMIN" == true ]]; then
    ADMIN_PHONE="$ADMIN_PHONE" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_FIRST="$ADMIN_FIRST" \
    ADMIN_LAST="$ADMIN_LAST" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    manage shell -c '
import os
from core.models import User
phone = os.environ["ADMIN_PHONE"]
user = User.objects.filter(phone=phone).first()
if user:
    user.role = User.Role.ADMIN; user.is_staff = True; user.is_superuser = True
    user.email = os.environ["ADMIN_EMAIL"]
    user.first_name = os.environ["ADMIN_FIRST"]; user.last_name = os.environ["ADMIN_LAST"]
    user.set_password(os.environ["ADMIN_PASSWORD"]); user.save()
    print("Compte administrateur mis a jour :", phone)
else:
    User.objects.create_superuser(
        phone=phone, email=os.environ["ADMIN_EMAIL"], password=os.environ["ADMIN_PASSWORD"],
        first_name=os.environ["ADMIN_FIRST"], last_name=os.environ["ADMIN_LAST"],
    )
    print("Compte administrateur cree :", phone)
' | sed 's/^/    /'
    ok "Compte administrateur pret"
fi

if [[ "$SEED_DEMO" == true ]]; then
    manage seed_demo | sed 's/^/    /'
    ok "Donnees de demonstration chargees"
fi

# ---------------------------------------------------------------- systemd
step "Service systemd"
cat > "/etc/systemd/system/${SERVICE}" <<UNITEOF
[Unit]
Description=REBOOT CLUB API (${APP_SLUG})
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=notify
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${BACKEND_DIR}
Environment=DJANGO_SETTINGS_MODULE=config.settings_prod
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=${BACKEND_DIR}/.env
RuntimeDirectory=${APP_SLUG}
RuntimeDirectoryMode=0755
ExecStart=${VENV}/bin/gunicorn config.wsgi:application \\
    --workers ${GUNICORN_WORKERS} \\
    --bind unix:/run/${APP_SLUG}/gunicorn.sock \\
    --timeout 60 \\
    --graceful-timeout 30 \\
    --access-logfile ${LOG_DIR}/access.log \\
    --error-logfile ${LOG_DIR}/error.log \\
    --capture-output
ExecReload=/bin/kill -s HUP \$MAINPID
Restart=always
RestartSec=5

# Cloisonnement : le service ne peut ecrire que dans ses propres dossiers.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${DATA_DIR} ${LOG_DIR} ${APP_DIR}

[Install]
WantedBy=multi-user.target
UNITEOF

cat > "/etc/systemd/system/${APP_SLUG}-installments.service" <<UNITEOF
[Unit]
Description=REBOOT CLUB (${APP_SLUG}) — traitement des echeances dues et en retard

[Service]
Type=oneshot
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${BACKEND_DIR}
Environment=DJANGO_SETTINGS_MODULE=config.settings_prod
EnvironmentFile=${BACKEND_DIR}/.env
ExecStart=${VENV}/bin/python ${BACKEND_DIR}/manage.py process_due_installments
UNITEOF

cat > "/etc/systemd/system/${APP_SLUG}-installments.timer" <<UNITEOF
[Unit]
Description=Traitement quotidien des echeances REBOOT CLUB (${APP_SLUG})

[Timer]
OnCalendar=*-*-* 06:00:00
Persistent=true

[Install]
WantedBy=timers.target
UNITEOF

systemctl daemon-reload
systemctl enable --now "$SERVICE" >/dev/null
systemctl enable --now "${APP_SLUG}-installments.timer" >/dev/null
sleep 3
systemctl is-active --quiet "$SERVICE" \
    || { journalctl -u "$SERVICE" -n 40 --no-pager; die "Le service ${SERVICE} n'a pas demarre."; }
ok "Service ${SERVICE} actif (socket /run/${APP_SLUG}/gunicorn.sock)"
ok "Traitement quotidien des echeances planifie a 06:00"

# ---------------------------------------------------------------- nginx
step "Site Nginx"
cat > "$NGINX_SITE" <<NGINXEOF
# REBOOT CLUB (${APP_SLUG}) — genere par install.sh.
# Ce fichier ne concerne que ce domaine : les autres sites restent intacts.
upstream ${APP_SLUG}_app {
    server unix:/run/${APP_SLUG}/gunicorn.sock fail_timeout=0;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    access_log ${LOG_DIR}/nginx-access.log;
    error_log  ${LOG_DIR}/nginx-error.log;

    # Televersement des pieces KYC (document 10 Mo + selfie 5 Mo).
    client_max_body_size 20m;

    location /static/ {
        alias ${DATA_DIR}/staticfiles/;
        access_log off;
        expires 30d;
        add_header Cache-Control "public";
    }

    location /media/ {
        alias ${DATA_DIR}/media/;
        access_log off;
        expires 7d;
        add_header X-Content-Type-Options nosniff;
    }

    location / {
        proxy_pass http://${APP_SLUG}_app;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_redirect off;
        proxy_read_timeout 60s;
    }
}
NGINXEOF
ln -sfn "$NGINX_SITE" "/etc/nginx/sites-enabled/${APP_SLUG}.conf"
nginx -t >/dev/null 2>&1 || { nginx -t; die "Configuration Nginx invalide : aucun rechargement effectue."; }
systemctl reload nginx
ok "Site ${DOMAIN} publie (rechargement, pas de redemarrage : les autres sites n'ont pas ete coupes)"

# ---------------------------------------------------------------- pare-feu
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "^Status: active"; then
    ufw allow "Nginx Full" >/dev/null 2>&1 || true
    ok "Regles UFW verifiees pour Nginx"
fi

# ---------------------------------------------------------------- https
if [[ "$USE_HTTPS" == true ]]; then
    step "Certificat HTTPS"
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" --redirect; then
        USE_HTTPS_OK=true
        ok "Certificat installe et renouvellement automatique actif"
    else
        USE_HTTPS_OK=false
        # Sans certificat, on retire les cookies securises sinon plus aucune
        # connexion a l'administration ne serait possible.
        write_settings_prod False
        systemctl restart "$SERVICE"
        warn "Certbot a echoue : l'application reste en HTTP."
        warn "Verifiez que ${DOMAIN} pointe bien vers ${SERVER_IP}, puis relancez :"
        warn "  certbot --nginx -d ${DOMAIN} --redirect && systemctl restart ${SERVICE}"
    fi
else
    USE_HTTPS_OK=false
    warn "HTTPS desactive : les cookies ne sont pas securises et le trafic circule en clair."
    warn "Activez-le des que possible : certbot --nginx -d ${DOMAIN} --redirect"
fi

# ---------------------------------------------------------------- config
step "Enregistrement de la configuration de deploiement"
umask 077
cat > "${CONF_DIR}/deploy.conf" <<CONFEOF
# Configuration de deploiement REBOOT CLUB — relue par update.sh.
APP_SLUG="${APP_SLUG}"
APP_USER="${APP_USER}"
APP_DIR="${APP_DIR}"
DATA_DIR="${DATA_DIR}"
LOG_DIR="${LOG_DIR}"
CONF_DIR="${CONF_DIR}"
BACKEND_SUBDIR="${BACKEND_SUBDIR}"
BACKEND_DIR="${BACKEND_DIR}"
VENV="${VENV}"
SERVICE="${SERVICE}"
NGINX_SITE="${NGINX_SITE}"
GIT_URL="${GIT_URL}"
GIT_BRANCH="${GIT_BRANCH}"
DOMAIN="${DOMAIN}"
SERVER_IP="${SERVER_IP}"
DB_NAME="${DB_NAME}"
DB_USER="${DB_USER}"
GUNICORN_WORKERS="${GUNICORN_WORKERS}"
CONFEOF
chmod 600 "${CONF_DIR}/deploy.conf"
umask 022
ok "Configuration enregistree dans ${CONF_DIR}/deploy.conf"

SCRIPT_SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_SOURCE}/update.sh" ]]; then
    install -m 750 "${SCRIPT_SOURCE}/update.sh" "/usr/local/bin/${APP_SLUG}-update"
    ok "Commande de mise a jour installee : ${APP_SLUG}-update"
fi

# ---------------------------------------------------------------- controle
step "Controle de sante"
SCHEME="http"; [[ "${USE_HTTPS_OK:-false}" == true ]] && SCHEME="https"
sleep 2
if curl -fsS --max-time 15 "${SCHEME}://${DOMAIN}/api/v1/health/" >/dev/null 2>&1; then
    ok "L'API repond sur ${SCHEME}://${DOMAIN}/api/v1/health/"
elif curl -fsS --max-time 15 --unix-socket "/run/${APP_SLUG}/gunicorn.sock" \
        "http://localhost/api/v1/health/" >/dev/null 2>&1; then
    warn "L'application repond en local mais pas via ${DOMAIN} : verifiez la zone DNS."
else
    warn "L'API ne repond pas encore. Diagnostic : journalctl -u ${SERVICE} -n 50"
fi

# ---------------------------------------------------------------- fin
cat <<FIN

${BOLD}${GREEN}Deploiement termine.${RESET}

  API .................. ${SCHEME}://${DOMAIN}/api/v1/
  Documentation ........ ${SCHEME}://${DOMAIN}/api/docs/
  Administration ....... ${SCHEME}://${DOMAIN}/admin/
  Version deployee ..... ${COMMIT} (branche ${GIT_BRANCH})

${BOLD}Commandes utiles${RESET}
  Mise a jour .......... sudo ${APP_SLUG}-update
  Etat du service ...... systemctl status ${SERVICE}
  Journaux temps reel .. journalctl -u ${SERVICE} -f
  Journaux applicatifs . tail -f ${LOG_DIR}/error.log
  Redemarrer ........... systemctl restart ${SERVICE}

${BOLD}A configurer cote mobile${RESET}
  EXPO_PUBLIC_API_URL=${SCHEME}://${DOMAIN}/api/v1

${DIM}Aucune autre application du serveur n'a ete modifiee : Nginx a ete recharge
et non redemarre, et seuls les fichiers ${APP_SLUG}.* ont ete crees.${RESET}

FIN
