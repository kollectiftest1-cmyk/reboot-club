# REBOOT CLUB

REBOOT CLUB est une application de gestion de clubs d'epargne et de credit construite a partir du cahier des charges valide. Le depot contient une API Django REST et une application mobile React Native sous Expo SDK 54.

## Architecture

- `backend/` : Django 5.2, Django REST Framework, JWT, OpenAPI, administration Django et PostgreSQL/SQLite.
- `mobile/` : React Native en JavaScript/JSX, Expo SDK 54, React Navigation, Redux Toolkit, Secure Store et cache hors ligne de consultation.
- `docker-compose.yml` : API et PostgreSQL pour un environnement local reproductible.

Les ecritures financieres utilisent des UUID et des references uniques. Les validations, refus, decaissements et remboursements passent par des services transactionnels et produisent des traces d'audit.

## Demarrage rapide

### Backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo
python manage.py runserver 0.0.0.0:8000
```

Documentation API : `http://127.0.0.1:8000/api/docs/`

### Mobile

Dans un second terminal :

```powershell
cd mobile
npm install
npm start
```

En mode Expo Go, l'application detecte automatiquement l'adresse LAN du PC depuis `Constants.expoConfig.hostUri`. Le PC et le telephone doivent utiliser le meme Wi-Fi et Django doit etre lance avec `0.0.0.0:8000`.

Si la detection automatique n'est pas possible (mode tunnel ou reseau d'entreprise), creer `mobile/.env` :

```env
EXPO_PUBLIC_API_URL=http://ADRESSE_IP_DU_PC:8000/api/v1
```

Apres toute modification de `.env`, effectuer un rechargement complet dans Expo Go.

## Comptes de demonstration

Le mot de passe commun cree par `seed_demo` est `Reboot2026!`.

| Profil | Numero de telephone |
| --- | --- |
| Administrateur | `+243810000001` |
| Chef de club | `+243810000002` |
| Preteur | `+243810000003` |
| Emprunteur | `+243810000004` |
| Co-emprunteur | `+243810000005` |
| Mandataire d'encaissement | `+243810000006` |

### Creer un compte administrateur

```powershell
cd backend
python manage.py createsuperuser
```

Django demande le numero au format international (`+243...`), l'e-mail, le prenom, le nom et le mot de passe. Le compte cree recoit automatiquement le role administrateur et peut se connecter a `http://127.0.0.1:8000/admin/` ainsi qu'a l'application mobile avec son numero. Le prenom saisi est celui affiche dans le message `Bonjour`.

Depuis l'application mobile, un administrateur peut aussi ouvrir `Gestion > Comptes et Profils > Creer un compte` pour creer un autre administrateur ou un chef de club. Un chef de club peut y creer uniquement les comptes preteur et emprunteur rattaches a ses propres clubs.

Pour servir un membre qui ne peut pas utiliser l'application, l'administrateur ouvre `Gestion > Operations clients`. Il peut y enregistrer et valider un depot en especes, soumettre une demande d'emprunt au nom d'un compte emprunteur et placer le capital libre d'un compte preteur dans un pret valide. Ces actions exigent le profil actif correspondant dans le club et conservent l'administrateur operateur dans le journal d'audit.

## Profils et financement participatif

- Un chef dispose d'abord du profil `Chef de club`; il peut demander les profils `Preteur` et `Emprunteur`. L'administrateur doit valider ses profils supplementaires.
- Un preteur ou un emprunteur peut demander l'autre profil depuis `Profil > Ajouter un profil`. Le profil apparait dans le selecteur apres validation.
- La bascule de profil recharge automatiquement les donnees et adapte navigation, tableau de bord, prets et permissions.
- Une demande de pret notifie le chef et les administrateurs. Apres validation, les preteurs actifs voient l'opportunite et choisissent leur participation.
- Avant confirmation, le preteur voit son gain estime, le total attendu, le retour mensuel et les dates d'echeance.
- Lorsque le financement atteint 100 %, une date de decaissement est proposee et toutes les parties sont notifiees. Le capital rembourse et les interets gagnes sont ensuite ventiles par preteur.

Les taux, commissions, penalites, plafonds et durees sont exclusivement geres par l'administrateur. Le chef peut seulement modifier le nom de son club.

## Verification

```powershell
cd backend
python manage.py test
python manage.py check
python manage.py process_due_installments

cd ..\mobile
npm run check
npx expo-doctor
```

## Modele financier

Le cout du credit se compose de **trois pourcentages FIXES du capital emprunte**, independants de la duree :

| Composante | Beneficiaire | Champ |
| --- | --- | --- |
| Interet | Preteur | `interest_rate` / `interest_total` |
| Commission | Application | `platform_fee_rate` / `fee_total` |
| Commission | Chef de club | `leader_commission_rate` / `leader_commission_total` |

Exemple avec 10 % application + 20 % preteur + 5 % chef sur 100 000 CDF : l'emprunteur voit **un seul chiffre**, 35 000 CDF d'interets, et rembourse 135 000 CDF. La ventilation entre les trois beneficiaires ne lui est jamais exposee.

### Duree et frequence de remboursement

La duree se choisit dans une liste (`1 semaine`, `2 semaines`, `1` a `6 mois`, `1 annee`) et la frequence egalement (`jour`, `semaine`, `mois`, `3 mois`, `4 mois`, `6 mois`, `annee`). Seules les frequences qui divisent exactement la duree et produisent plus d'une echeance sont proposees : une duree d'une semaine n'accepte donc qu'un remboursement quotidien. Le montant total est divise par le nombre d'echeances ainsi obtenu.

### Prets collectifs

Un emprunteur peut associer jusqu'a deux autres membres de son club. Le capital est divise en parts egales par defaut ; chaque co-emprunteur peut saisir la somme qu'il prend en charge, et le reliquat se repartit entre les parts non saisies. Le dossier n'est visible des preteurs qu'une fois toutes les reponses recues et le capital entierement reparti.

### Circuit des operations de caisse

- **Encaissements** (validation d'un depot, remboursement d'une echeance) : administrateur uniquement, ou le **mandataire d'encaissement** designe par l'administrateur pour un pret precis.
- **Decaissements** (paiement d'un retrait, decaissement d'un pret) : administrateur uniquement.
- **Placements** : soumis par le preteur, le capital est immediatement reserve mais ne finance le pret qu'apres validation de l'administrateur.

### Cloisonnement des roles

| Role | Voit | Ne voit pas |
| --- | --- | --- |
| Administrateur | Tout | — |
| Chef de club | Son club, sa commission | Les autres clubs, la commission de l'application, l'interet des preteurs |
| Preteur | Son capital, son interet, le marche des prets | L'identite des emprunteurs, les commissions, les autres preteurs, les clubs |
| Emprunteur | Un cout global unique, son echeancier, sa quote-part | La ventilation des commissions, les preteurs qui financent son pret |
| Mandataire | Les prets qui lui sont confies | Le reste de la plateforme |

Le preteur n'a **aucun lien avec les clubs** : son portefeuille est global et il peut rendre son profil anonyme depuis `Profil`.

## Decisions MVP

- Interet et commissions fixes, en pourcentage du capital, configurables par club et par defaut au niveau plateforme.
- Arrondi financier uniforme a deux decimales, `ROUND_HALF_UP`.
- Allocation des preteurs par capital libre disponible.
- Liberation proportionnelle du capital apres remboursement du principal.
- SQLite en developpement direct et PostgreSQL pour Docker/production.
- Actions financieres critiques en ligne uniquement; tableaux de bord, clubs et prets sont consultables depuis le cache en cas de coupure.
- Chat par club avec messages publics, annonces de responsables et messages prives exposes par l'API.
- OTP de cinq minutes avec cinq tentatives maximum; le code n'est retourne par l'API qu'en developpement.
- Traitement planifiable des rappels, retards et penalites via `process_due_installments`.

La couverture detaillee du cahier des charges se trouve dans `FEATURE_COVERAGE.md`. L'envoi reel des SMS OTP, Mobile Money, push et stockage objet reste a brancher lorsqu'un prestataire et les regles juridiques auront ete choisis; les contrats metier et points d'integration sont deja isoles du mobile.
#   r e b o o t - c l u b  
 