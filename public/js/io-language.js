const IO_NAV_TRANSLATIONS = {
  es: {
    Home: "Inicio",
    Series: "Series",
    Movies: "Películas",
    Books: "Libros",
    "New & Popular": "Novedades y populares",
    "TV guide": "Guía de TV",
    Search: "Buscar",
    Notifications: "Notificaciones",
    "Account menu": "Menú de cuenta",
    "Account & preferences": "Cuenta y preferencias",
    "Email & connections": "Correo y conexiones",
    "Viewing profiles": "Perfiles",
    "Email & sign-in setup": "Correo e inicio de sesión",
    "Live channels": "Canales en directo",
    "Discussion reports": "Denuncias de comentarios",
    "My requests & reports": "Mis solicitudes e informes",
    "Library review queue": "Revisión de biblioteca",
    "Public profile & privacy": "Perfil público y privacidad",
    "Discover people": "Descubrir personas",
    Passkeys: "Claves de acceso",
    "Playback & subtitle preferences": "Reproducción y subtítulos",
    "Tailor recommendations": "Personalizar recomendaciones",
    "Your data & account": "Tus datos y cuenta",
    "TV devices & remote": "Dispositivos de TV y mando",
    "Personal tracker sync": "Sincronizar listas personales",
    "Notification categories": "Categorías de notificaciones",
    "Discord watch activity": "Actividad de reproducción en Discord",
    "Back to Browse": "Volver al catálogo",
    "My List": "Mi lista",
    Settings: "Configuración",
    "Watch History": "Historial",
    "Sign out": "Cerrar sesión",
  },
  fr: {
    Home: "Accueil",
    Series: "Séries",
    Movies: "Films",
    Books: "Livres",
    "New & Popular": "Nouveautés et tendances",
    "TV guide": "Guide TV",
    Search: "Rechercher",
    Notifications: "Notifications",
    "Account menu": "Menu du compte",
    "Account & preferences": "Compte et préférences",
    "Email & connections": "E-mail et connexions",
    "Viewing profiles": "Profils",
    "Email & sign-in setup": "E-mail et connexion",
    "Live channels": "Chaînes en direct",
    "Discussion reports": "Signalements de commentaires",
    "My requests & reports": "Mes demandes et signalements",
    "Library review queue": "Validation de la bibliothèque",
    "Public profile & privacy": "Profil public et confidentialité",
    "Discover people": "Découvrir des membres",
    Passkeys: "Clés d’accès",
    "Playback & subtitle preferences": "Lecture et sous-titres",
    "Tailor recommendations": "Personnaliser les recommandations",
    "Your data & account": "Vos données et votre compte",
    "TV devices & remote": "Téléviseurs et télécommande",
    "Personal tracker sync": "Synchronisation des listes",
    "Notification categories": "Catégories de notifications",
    "Discord watch activity": "Activité de lecture Discord",
    "Back to Browse": "Retour au catalogue",
    "My List": "Ma liste",
    Settings: "Paramètres",
    "Watch History": "Historique",
    "Sign out": "Se déconnecter",
  },
  ja: {
    Home: "ホーム",
    Series: "シリーズ",
    Movies: "映画",
    Books: "本",
    "New & Popular": "新着・人気",
    "TV guide": "テレビ番組表",
    Search: "検索",
    Notifications: "通知",
    "Account menu": "アカウントメニュー",
    "Account & preferences": "アカウントと設定",
    "Email & connections": "メールと連携",
    "Viewing profiles": "プロフィール",
    "Email & sign-in setup": "メール・ログイン設定",
    "Live channels": "ライブチャンネル",
    "Discussion reports": "コメントの報告",
    "My requests & reports": "リクエストと報告",
    "Library review queue": "ライブラリの審査",
    "Public profile & privacy": "公開プロフィールとプライバシー",
    "Discover people": "ユーザーを探す",
    Passkeys: "パスキー",
    "Playback & subtitle preferences": "再生と字幕の設定",
    "Tailor recommendations": "おすすめの調整",
    "Your data & account": "データとアカウント",
    "TV devices & remote": "テレビとリモコン",
    "Personal tracker sync": "個人リストの同期",
    "Notification categories": "通知カテゴリー",
    "Discord watch activity": "Discordの視聴アクティビティ",
    "Back to Browse": "一覧に戻る",
    "My List": "マイリスト",
    Settings: "設定",
    "Watch History": "視聴履歴",
    "Sign out": "ログアウト",
  },
};
(function () {
  const originals = new WeakMap();
  let scheduled = false;
  function translate() {
    scheduled = false;
    const lang = Store.activeProfile?.experience?.interfaceLanguage || "en",
      dictionary = IO_NAV_TRANSLATIONS[lang] || {};
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll(
      ".navbar a,.io-settings-nav a,.io-settings-page>h1,.io-footer a",
    )) {
      if (el.children.length) continue;
      const old = originals.get(el),
        text = el.textContent,
        source = old && old.last === text ? old.source : text,
        translated = dictionary[source] || source;
      if (text !== translated) el.textContent = translated;
      originals.set(el, { source, last: translated });
    }
  }
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(translate);
    }
  }).observe(document.getElementById("app"), {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.ioTranslateNavigation = translate;
})();
