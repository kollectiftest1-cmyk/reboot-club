# Deploiement du backend REBOOT CLUB sur un VPS

Deploiement classique, sans Docker : **PostgreSQL + Gunicorn + systemd + Nginx**.

Les deux scripts sont concus pour un **serveur qui heberge deja d'autres applications**.

## Ce qui garantit qu'aucune autre application n'est touchee

| Risque habituel | Protection mise en place |
| --- | --- |
| Conflit de port | Gunicorn ecoute sur un **socket Unix** (`/run/<app>/gunicorn.sock`), aucun port n'est reserve |
| Ecrasement d'un site Nginx | Un seul fichier `sites-available/<app>.conf` ; le script **refuse** de continuer si le domaine est deja servi ailleurs |
| Coupure des autres sites | `nginx -t` puis `systemctl reload nginx` (jamais `restart`) |
| Ecrasement d'un dossier | Le script **refuse** de continuer si `/opt/<app>` existe sans avoir ete cree par lui |
| Melange des bases | Role et base PostgreSQL dedies ; une base existante n'est jamais recreee |
| Droits trop larges | Utilisateur systeme dedie sans shell, `ProtectSystem=full`, `ReadWritePaths` limite aux dossiers de l'app |
| Perte des fichiers televerses | `MEDIA_ROOT` place hors du depot Git, dans `/var/lib/<app>/media` |

## Installation

```bash
scp deploy/install.sh deploy/update.sh root@IP_DU_SERVEUR:/root/
ssh root@IP_DU_SERVEUR
cd /root && sudo bash install.sh
```

Le script pose les questions dans cet ordre, puis affiche un recapitulatif avant
d'ecrire quoi que ce soit :

1. **Nom technique** de l'application (defaut `reboot-club`) — determine l'utilisateur, les dossiers, le service et le site Nginx
2. **IP publique** et **nom de domaine** de l'API
3. **HTTPS** Let's Encrypt (o/n) et e-mail de contact
4. **URL du depot GitHub**, **branche**, **jeton d'acces** si le depot est prive, **sous-dossier du backend**
5. **Base de donnees** : nom, utilisateur, mot de passe
6. **Compte administrateur** REBOOT CLUB (telephone, e-mail, prenom, nom, mot de passe)
7. **Workers Gunicorn**, **origines CORS**, chargement ou non des donnees de demonstration

> Faites pointer l'enregistrement DNS `A` du domaine vers l'IP du serveur **avant**
> de lancer le script, sinon Let's Encrypt echouera.

### Ce que l'installation met en place

```
/opt/<app>/                    code source (depot Git)
/var/lib/<app>/venv/           environnement Python
/var/lib/<app>/media/          pieces KYC et justificatifs televerses
/var/lib/<app>/staticfiles/    fichiers statiques servis par Nginx
/var/lib/<app>/backups/        sauvegardes automatiques avant chaque mise a jour
/var/log/<app>/                journaux Gunicorn et Nginx
/etc/<app>/deploy.conf         configuration relue par la mise a jour (0600)
/etc/<app>/git-credentials     jeton GitHub (0600)
```

Deux unites systemd sont creees : le service web et un **timer quotidien a 06:00**
qui execute `process_due_installments` (echeances dues, retards, penalites).

Le jeton GitHub n'est jamais inscrit dans l'URL du depot : il reste dans un fichier
d'identifiants lisible par le seul utilisateur de l'application.

## Mise a jour

```bash
sudo reboot-club-update
```

Sequence executee : sauvegarde de la base et de la version courante, recuperation
du code, dependances, migrations, fichiers statiques, redemarrage, controle de
sante. **En cas d'echec a n'importe quelle etape, le code precedent est restaure
automatiquement** et le service relance sur l'ancienne version.

| Commande | Effet |
| --- | --- |
| `sudo reboot-club-update` | Mise a jour sur la branche configuree |
| `sudo reboot-club-update --check` | Liste les commits et migrations a venir, sans rien appliquer |
| `sudo reboot-club-update --branch dev` | Deploie une autre branche |
| `sudo reboot-club-update --ref a1b2c3d` | Deploie un commit precis |
| `sudo reboot-club-update --rollback` | Revient a la version precedente |
| `sudo reboot-club-update --yes` | Sans confirmation (utilisable en cron) |

Les 10 dernieres sauvegardes de base sont conservees dans `/var/lib/<app>/backups/`.

### Restaurer la base apres un incident

Le retour arriere restaure le **code** mais jamais les migrations, car une
migration inverse peut detruire des donnees. Restauration manuelle :

```bash
sudo systemctl stop reboot-club
gunzip -c /var/lib/reboot-club/backups/<base>-<date>.sql.gz | sudo -u postgres psql <base>
sudo systemctl start reboot-club
```

## Exploitation courante

```bash
systemctl status reboot-club            # etat du service
journalctl -u reboot-club -f            # journaux en temps reel
tail -f /var/log/reboot-club/error.log  # erreurs applicatives
systemctl restart reboot-club           # redemarrage
systemctl list-timers reboot-club-installments.timer
```

## Cote application mobile

Dans `mobile/.env` :

```env
EXPO_PUBLIC_API_URL=https://votre-domaine/api/v1
```

## Installer une seconde instance (recette, autre client)

Relancez `install.sh` avec un **nom technique different** (`reboot-club-recette`)
et un **autre domaine**. Les deux instances cohabitent sans interference : chacune
a son utilisateur, sa base, son socket, son service et son site Nginx.
