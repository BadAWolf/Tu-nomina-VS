/* Shared account dialogs. One copy of the markup for every page that offers an account. */
(function () {
  'use strict';
  if (document.getElementById('auth-dialog')) return;
  const PROVINCES = [["02", "Albacete"], ["03", "Alicante / Alacant"], ["04", "Almería"], ["01", "Araba / Álava"], ["33", "Asturias"], ["05", "Ávila"], ["06", "Badajoz"], ["07", "Illes Balears"], ["08", "Barcelona"], ["48", "Bizkaia"], ["09", "Burgos"], ["10", "Cáceres"], ["11", "Cádiz"], ["39", "Cantabria"], ["12", "Castellón / Castelló"], ["13", "Ciudad Real"], ["14", "Córdoba"], ["15", "A Coruña"], ["16", "Cuenca"], ["20", "Gipuzkoa"], ["17", "Girona"], ["18", "Granada"], ["19", "Guadalajara"], ["21", "Huelva"], ["22", "Huesca"], ["23", "Jaén"], ["24", "León"], ["25", "Lleida"], ["27", "Lugo"], ["28", "Madrid"], ["29", "Málaga"], ["30", "Murcia"], ["31", "Navarra"], ["32", "Ourense"], ["34", "Palencia"], ["35", "Las Palmas"], ["36", "Pontevedra"], ["26", "La Rioja"], ["37", "Salamanca"], ["38", "Santa Cruz de Tenerife"], ["40", "Segovia"], ["41", "Sevilla"], ["42", "Soria"], ["43", "Tarragona"], ["44", "Teruel"], ["45", "Toledo"], ["46", "Valencia / València"], ["47", "Valladolid"], ["49", "Zamora"], ["50", "Zaragoza"], ["51", "Ceuta"], ["52", "Melilla"], ["99", "Fuera de España"]];
  const TEXT = Object.freeze({own: "Quiero recibir por correo novedades de la calculadora, consejos y ofertas propias de Nómina Vigilante relacionadas con la seguridad privada.", partners: "Quiero recibir por correo promociones de formación, productos y servicios de colaboradores del sector de la seguridad privada, enviadas por Nómina Vigilante, sin ceder mi correo a esos colaboradores.", personalize: "Soy mayor de edad y autorizo a Nómina Vigilante a usar la franja de edad y la ciudad o provincia que indique para adaptar los correos publicitarios que haya aceptado. Puedo retirar este permiso y borrar estos datos sin perder mi cuenta."});
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value === null || value === undefined) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children) if (child !== null && child !== undefined) node.append(child);
    return node;
  };
  const check = (id, title, text, extra = {}) => el('label', {className: 'auth-check', for: id},
    el('input', Object.assign({type: 'checkbox', id}, extra)), el('span', {}, el('strong', {text: title}), text));
  function provinceSelect(id) {
    const select = el('select', {id, autocomplete: 'address-level1'}, el('option', {value: '', text: 'Elige tu provincia'}));
    for (const [value, label] of PROVINCES) select.append(el('option', {value, text: label}));
    return select;
  }
  // The same optional block is used in the sign-up form, the Google consent step and the welcome dialog.
  function marketingBlock(prefix, legendText) {
    return el('fieldset', {className: 'marketing-options', id: prefix + '-fields'},
      el('legend', {text: legendText}),
      check(prefix + '-own', 'Novedades y consejos', TEXT.own),
      check(prefix + '-partners', 'Formación y ofertas del sector', TEXT.partners),
      el('div', {className: 'marketing-zone', id: prefix + '-zone', hidden: true},
        check(prefix + '-personalize', 'Ofertas de mi zona', TEXT.personalize),
        el('label', {for: prefix + '-province', text: '¿De dónde eres?'}),
        provinceSelect(prefix + '-province')),
      el('p', {className: 'marketing-note'}, 'Todo es opcional y puedes darte de baja cuando quieras. ',
        el('a', {href: 'privacidad.html#publicidad', target: '_blank', rel: 'noopener', text: 'Cómo usamos estos datos'}), '.'));
  }
  const auth = el('dialog', {className: 'auth-dialog', id: 'auth-dialog', 'aria-labelledby': 'auth-title', 'aria-describedby': 'auth-intro'},
    el('button', {className: 'auth-close', id: 'auth-close', type: 'button', 'aria-label': 'Cerrar'}, '×'),
    el('h2', {id: 'auth-title', text: 'Crea tu cuenta gratis'}),
    el('p', {id: 'auth-intro'}),
    el('div', {id: 'auth-provider-options'},
      el('button', {type: 'button', className: 'account-secondary auth-google', id: 'auth-google', text: 'Continuar con Google'}),
      el('p', {id: 'auth-google-note', hidden: true, text: 'Disponible próximamente.'}),
      el('p', {className: 'auth-divider', text: 'o con tu correo electrónico'})),
    el('form', {id: 'auth-form'},
      el('div', {id: 'auth-email-field'},
        el('label', {for: 'auth-email', text: 'Correo electrónico'}),
        el('input', {type: 'email', id: 'auth-email', name: 'email', required: true, autocomplete: 'email', maxlength: '254', placeholder: 'tu@correo.com'})),
      el('div', {id: 'auth-password-field'},
        el('label', {for: 'auth-password', text: 'Contraseña'}),
        el('input', {id: 'auth-password', type: 'password', name: 'password', required: true, minlength: '12', autocomplete: 'new-password'}),
        el('p', {id: 'auth-password-hint', text: 'Mínimo 12 caracteres.'})),
      el('div', {id: 'auth-confirm-field'},
        el('label', {for: 'auth-confirm', text: 'Repite la contraseña'}),
        el('input', {id: 'auth-confirm', type: 'password', required: true, autocomplete: 'new-password'})),
      el('div', {id: 'auth-marketing-step'}, marketingBlock('signup', 'Ofertas y novedades por correo · Opcional')),
      el('div', {id: 'auth-terms-field'},
        el('label', {className: 'auth-check', for: 'auth-terms'},
          el('input', {type: 'checkbox', id: 'auth-terms', required: true}),
          el('span', {}, 'He leído y acepto las ', el('a', {href: 'condiciones.html', target: '_blank', rel: 'noopener', text: 'condiciones de uso'}),
            ' y he leído la ', el('a', {href: 'privacidad.html', target: '_blank', rel: 'noopener', text: 'información sobre privacidad'}), '.'))),
      el('div', {id: 'auth-captcha', hidden: true},
        el('div', {id: 'auth-captcha-widget'}),
        el('p', {id: 'auth-captcha-status', className: 'auth-status', role: 'status', 'aria-live': 'polite'}),
        el('button', {type: 'button', id: 'auth-captcha-retry', className: 'auth-link', text: 'Reintentar comprobación'})),
      el('button', {type: 'submit', className: 'account-primary', id: 'auth-submit', text: 'Crear cuenta gratis'}),
      el('p', {id: 'auth-status', className: 'auth-status', role: 'status', 'aria-live': 'polite'})),
    el('div', {id: 'auth-switches', className: 'account-actions'},
      el('button', {type: 'button', className: 'auth-link', 'data-auth-open': 'signin', text: 'Ya tengo cuenta'}),
      el('button', {type: 'button', className: 'auth-link', 'data-auth-open': 'signup', text: 'Crear cuenta'}),
      el('button', {type: 'button', className: 'auth-link', 'data-auth-open': 'reset', text: 'He olvidado mi contraseña'})),
    el('button', {type: 'button', className: 'auth-link', id: 'auth-resend', hidden: true, text: 'Reenviar verificación'}));

  // Fallback for accounts created before the choice was part of sign-up.
  const welcome = el('dialog', {className: 'auth-dialog marketing-welcome', id: 'marketing-dialog', 'aria-labelledby': 'marketing-title', 'aria-describedby': 'marketing-intro'},
    el('button', {className: 'auth-close', id: 'marketing-close', type: 'button', 'aria-label': 'Cerrar'}, '×'),
    el('p', {className: 'marketing-kicker', text: 'Un último detalle'}),
    el('h2', {id: 'marketing-title', text: '¿Te avisamos de ofertas y novedades?'}),
    el('p', {id: 'marketing-intro', text: 'Formación, empleo y novedades del sector, si quieres recibirlas. Todo es opcional.'}),
    el('form', {id: 'marketing-welcome-form'},
      marketingBlock('auth-marketing', 'Ofertas y novedades por correo · Opcional'),
      el('div', {className: 'marketing-welcome-actions'},
        el('button', {type: 'submit', className: 'account-primary', id: 'marketing-welcome-save', text: 'Guardar mi elección'}),
        el('button', {type: 'button', className: 'account-secondary', id: 'marketing-skip', text: 'No, gracias'})),
      el('p', {id: 'marketing-welcome-status', className: 'auth-status', role: 'status', 'aria-live': 'polite'})));

  const toast = el('p', {id: 'account-toast', className: 'account-toast', role: 'status', 'aria-live': 'polite', hidden: true});
  document.body.append(auth, welcome, toast);

  // Reveal the province only when the person chooses to receive emails.
  for (const prefix of ['signup', 'auth-marketing']) {
    const own = document.getElementById(prefix + '-own'), partners = document.getElementById(prefix + '-partners');
    const zone = document.getElementById(prefix + '-zone'), personalize = document.getElementById(prefix + '-personalize');
    const province = document.getElementById(prefix + '-province');
    const sync = () => {
      const mail = own.checked || partners.checked;
      zone.hidden = !mail;
      if (!mail) personalize.checked = false;
      province.disabled = !personalize.checked;
      province.required = personalize.checked;
      if (!personalize.checked) province.value = '';
    };
    [own, partners, personalize].forEach(input => input.addEventListener('change', sync));
    sync();
  }
  window.VigilanteAuthUI = Object.freeze({
    read(prefix) {
      const $ = id => document.getElementById(prefix + '-' + id);
      const personalize = $('personalize').checked && Boolean($('province').value);
      return {own: $('own').checked, partners: $('partners').checked, personalize, province: personalize ? $('province').value : null};
    },
    fill(prefix, choice) {
      const $ = id => document.getElementById(prefix + '-' + id);
      $('own').checked = Boolean(choice && choice.own);
      $('partners').checked = Boolean(choice && choice.partners);
      $('own').dispatchEvent(new Event('change'));
      $('personalize').checked = Boolean(choice && choice.personalize && choice.province);
      $('personalize').dispatchEvent(new Event('change'));
      $('province').value = choice && choice.personalize && choice.province || '';
    },
    toast(text) {
      toast.textContent = text; toast.hidden = !text;
      clearTimeout(toast._timer);
      if (text) toast._timer = setTimeout(() => { toast.hidden = true; }, 6000);
    }
  });
})();
