# Couverture fonctionnelle REBOOT CLUB

Ce document relie le cahier des charges valide a l'implementation. `Implemente` signifie que le flux metier et les permissions existent. `Connecteur requis` signifie que le logiciel est prepare mais qu'un fournisseur, des cles ou une decision juridique/metier sont indispensables.

## Authentification et identite

| Exigences | Couverture |
| --- | --- |
| FR-AUTH-01, 03 | OTP a six chiffres, expiration cinq minutes, cinq tentatives, verification et consommation unique. L'envoi SMS reel requiert un fournisseur. |
| FR-AUTH-02, 06 | Connexion numero + mot de passe, JWT court, rotation et liste noire des refresh tokens. |
| FR-AUTH-04 | Champs proteges pour document d'identite, selfie et statut KYC; file de controle mobile et validation finale reservee a l'administrateur. L'ecran de capture guide reste une evolution. |
| FR-AUTH-05 | Secure Store et permission Face ID configures. Le deverrouillage biometrique complet necessite un development build et `expo-local-authentication`. |
| FR-AUTH-07 | Acceptation horodatee des conditions lors de l'inscription. |

## Clubs, membres et gouvernance

| Exigences | Couverture |
| --- | --- |
| FR-CLUB-01 a 06 | CRUD et regles financieres reserves a l'admin; le chef peut seulement renommer son club. La fiche detaillee adapte membres, prets et finances au profil actif. |
| FR-MEM-01 a 07 | CRUD comptes admin, demandes de profils multiples, bascule de profil, validation separee, invitations, statuts, archivage logique et audit. Le chef ne peut pas valider son propre profil supplementaire. |
| Matrice des permissions | Admin global, chef limite a son club, preteur limite a ses fonds, emprunteur limite a ses prets, mediateur limite aux dossiers affectes. |

## Finance coeur

| Exigences | Couverture |
| --- | --- |
| FR-DEP-01 a 07 | Depots, preuves, statuts, validation atomique, capital disponible et protection contre la double validation. |
| Operations assistees | L'admin peut enregistrer et valider un depot en especes, soumettre une demande pour un emprunteur sans acces mobile et affecter le capital libre d'un preteur a un pret. Le membre doit posseder le profil actif correspondant et l'operateur admin reste trace dans l'audit. |
| FR-LOAN-01 a 09 | Simulation, demande individuelle ou collective, notifications chef/admin, decision motivee, financement multi-preteurs valide par l'admin, progression, programmation du decaissement et echeancier a la frequence choisie. |
| FR-REP-01 a 09 | Echeances detaillees, remboursements partiels/complets, ventilation, soldes, cloture et liberation proportionnelle du capital. |
| Retour preteur | Projection avant participation (gain, total, retour mensuel, premieres/dernieres dates), puis suivi du capital rembourse et des interets reellement gagnes. |
| FR-WD-01 a 05 | Retrait partiel, controle du capital libre, decision, motif et audit. |
| RG-05, 06, 09, 13, 14 | Decimal exact, arrondi `ROUND_HALF_UP`, taux/durees/plafonds configurables, capital engage et devise explicite. |

## Retards, communication et litiges

| Exigences | Couverture |
| --- | --- |
| FR-REP-05, 06 | Commande planifiable qui marque les echeances dues/en retard, applique la penalite une seule fois et notifie. |
| FR-NOT-01, 02, 05, 06 | Chat par club, boite de conversations admin avec dernier message/non-lus puis ouverture du club, annonces, messages prives API, historique et lecture. |
| FR-NOT-03, 04 | Evenements et rappels generes en base. Livraison push/SMS reelle: connecteur requis. |
| FR-DIS-01 a 06 | Reclamations liees aux operations, affectation, gel, decision motivee, notification et historique d'audit. |

## Pilotage, securite et exploitation

| Exigences | Couverture |
| --- | --- |
| FR-REPOT-01 a 07 | Tableau de bord role, synthese par club, interets, retards, fonds et journal d'audit. |
| FR-REPOT-08 | Export CSV implemente. PDF/Excel natifs restent une evolution. |
| Mode hors ligne | Cache local du tableau de bord, clubs et prets; les actions financieres exigent le reseau comme demande. |
| Synchronisation mobile | Redux Toolkit invalide les domaines concernes apres chaque action et recharge automatiquement tableaux de bord, clubs, prets, membres, validations, chats et reclamations. |
| Mobile Money | References internes/prestataire prevues. Connecteur et webhooks signes requis apres choix du fournisseur. |
| Sauvegarde/restauration | PostgreSQL et volume Docker fournis; planification et stockage chiffre dependent de l'hebergeur de production. |
| Observabilite | Health check, logs Django et audit metier. Sentry/metriques de production restent a configurer. |


## Evolutions du modele financier

| Regle | Couverture |
| --- | --- |
| Cout du credit en trois composantes | `interest_rate` (preteur), `platform_fee_rate` (application) et `leader_commission_rate` (chef de club) sont des pourcentages FIXES du capital. `loan_cost_breakdown` calcule les trois montants ; `Loan.charge_total` expose le total unique vu par l'emprunteur. |
| Duree par selection | `LOAN_DURATIONS` : 1 et 2 semaines, 1 a 6 mois, 1 annee. Chaque club restreint la liste via `allowed_durations`. |
| Frequence par selection et coherence | `REPAYMENT_FREQUENCIES` + `installment_count()` : une frequence n'est proposee que si elle divise exactement la duree et produit plus d'une echeance. `installment_dates()` place la derniere echeance a la date de fin exacte. |
| Objet du pret en liste deroulante | Modele `LoanPurpose`, CRUD administrateur (`/loan-purposes/`), expose aux clients par `/loan-catalog/`. |
| Prets collectifs | `LoanBorrower` porte la quote-part, son statut et le drapeau `share_is_manual`. Repartition egale par defaut, redistribution du reliquat sur les parts non saisies, passage en `submitted` seulement quand tout le monde a accepte et que le capital est entierement reparti. |
| Validation des placements | `LoanFunding.pending_amount` reserve le capital du preteur ; seul `review_funding()` (administrateur) alimente `amount` et finance reellement le pret. |
| Mandataire d'encaissement | Role `collector` et `Loan.collection_agent`. `can_collect()` limite `record-payment` a l'administrateur ou au mandataire designe pour ce pret. |
| Encaissements et decaissements | `validate_deposit`, `disburse_loan` et la decision de retrait sont reserves a l'administrateur. |
| Cloisonnement par role | `LoanSerializer.to_representation` et `ClubSerializer.to_representation` masquent les champs interdits ; `accessible_clubs()` retire tout club au profil preteur. |
| Anonymat du preteur | `User.anonymous_lender` et `User.public_name` remplacent le nom partout ou le placement est expose. |

## Taches de production obligatoires

1. Choisir le fournisseur SMS/push et brancher l'envoi aux evenements existants.
2. Choisir le fournisseur Mobile Money et implementer les webhooks signes/idempotents.
3. Valider juridiquement KYC, conservation, taux, penalites et conditions en RDC.
4. Planifier quotidiennement `python manage.py process_due_installments`.
5. Configurer PostgreSQL, HTTPS, stockage objet prive, sauvegardes et supervision.
