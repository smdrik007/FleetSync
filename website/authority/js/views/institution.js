/** Institution — `institutions` (name and logo are editable; the slug is fixed). */
import { h, pageHead, initials, kv } from '../ui.js';
import { invalidate } from '../data.js';

export default {
  title: 'Institution',

  async render() {
    const inst = await Api.get('/fleet/institution');

    const preview = h('div', { class: 'avatar avatar-lg' }, initials(inst.name));
    const paintPreview = (name, url) => {
      preview.replaceChildren();
      if (url) {
        const img = h('img', { src: url, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' } });
        img.addEventListener('error', () => { preview.replaceChildren(initials(name)); });
        preview.append(img);
      } else preview.textContent = initials(name);
    };
    paintPreview(inst.name, inst.logoUrl);

    const name = h('input', { class: 'form-input', id: 'inst-name-input', value: inst.name, required: true });
    const logo = h('input', { class: 'form-input', id: 'inst-logo-input', type: 'url', placeholder: 'https://…/logo.png', value: inst.logoUrl || '' });
    const err = h('div', { class: 'form-error hidden', role: 'alert' });
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
    [name, logo].forEach((el) => el.addEventListener('input', () => { err.classList.add('hidden'); paintPreview(name.value || inst.name, logo.value.trim()); }));

    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) { err.textContent = 'Institution name is required.'; err.classList.remove('hidden'); name.focus(); return; }
      save.disabled = true; save.textContent = 'Saving…';
      try {
        const updated = await Api.put('/fleet/institution', { name: name.value.trim(), logoUrl: logo.value.trim() || null });
        invalidate();
        window.dispatchEvent(new CustomEvent('fs:institution-changed', { detail: updated }));
        Toast.success('Institution updated.');
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
      finally { save.disabled = false; save.textContent = 'Save changes'; }
    } },
      h('div', { class: 'flex items-center gap-4 mb-4' }, preview, h('div', {}, h('div', { class: 'cell-main' }, 'Branding'), h('div', { class: 'cell-sub' }, 'Shown in the console sidebar.'))),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: 'inst-name-input' }, 'Institution name *'), name),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: 'inst-logo-input' }, 'Logo URL'), logo, h('div', { class: 'form-hint' }, 'Optional. Falls back to initials.')),
      err, h('div', { class: 'mt-4' }, save));

    return h('div', {}, pageHead({ title: 'Institution', subtitle: 'Your organisation on FleetSync.' }),
      h('div', { class: 'grid-2' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Details')), form),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Identifiers')),
          kv([['Slug', inst.slug], ['Institution ID', h('code', { class: 'text-sm', style: { wordBreak: 'break-all' } }, inst.id)]]),
          h('p', { class: 'text-muted mt-4' }, 'The slug and ID are fixed and used by the apps to find your institution.'))));
  },
};
