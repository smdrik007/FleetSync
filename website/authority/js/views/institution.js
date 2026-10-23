/** Institution — `institutions` (name and logo are editable; the slug is fixed). */
import { h, pageHead, initials, kv } from '../ui.js';
import { invalidate, Tenant } from '../data.js';

export default {
  title: 'Institution',

  async render() {
    const inst = await Api.get('/fleet/institution');

    const preview = h('div', { class: 'avatar avatar-lg' }, initials(inst.name));
    const logoNote = h('div', { class: 'form-hint' }, 'Optional. Falls back to initials.');
    let previewSeq = 0;
    const paintPreview = (name, url) => {
      const seq = ++previewSeq;
      preview.classList.remove('has-logo');
      preview.textContent = initials(name);
      if (!url) { logoNote.textContent = 'Optional. Falls back to initials.'; return; }
      logoNote.textContent = 'Loading the image…';
      const img = h('img', { src: url, alt: '', referrerpolicy: 'no-referrer' });
      img.addEventListener('load', () => { if (seq !== previewSeq) return; preview.classList.add('has-logo'); preview.replaceChildren(img); logoNote.textContent = 'Looks good. Save to apply it.'; });
      img.addEventListener('error', () => { if (seq !== previewSeq) return; logoNote.textContent = 'This address did not load as an image. Use a direct link to a PNG, JPG or SVG file.'; });
    };
    paintPreview(inst.name, inst.logoUrl);

    const name = h('input', { class: 'form-input', id: 'inst-name-input', value: inst.name, required: true });
    const logo = h('input', { class: 'form-input', id: 'inst-logo-input', type: 'url', placeholder: 'https://…/logo.png', value: inst.logoUrl || '' });
    const phone = h('input', { class: 'form-input', id: 'inst-phone-input', type: 'tel', placeholder: '+880 1XXX-XXXXXX', value: inst.contactPhone || '' });
    const email = h('input', { class: 'form-input', id: 'inst-email-input', type: 'email', placeholder: 'transport@example.edu', value: inst.contactEmail || '' });
    const address = h('input', { class: 'form-input', id: 'inst-address-input', placeholder: 'Transport office, campus', value: inst.contactAddress || '' });
    const TYPES = [['vehicle', 'Vehicle: fleet, drivers, routes, trips, maintenance, fuel'], ['people', 'People: people with trackers, guardians, safe zones'], ['things', 'Things: same screens as People']];
    const type = h('select', { class: 'form-select', id: 'inst-type-input' }, ...TYPES.map(([v, l]) => h('option', { value: v }, l)));
    type.value = inst.trackingType || 'vehicle';
    // Vehicle GPS history (people have their own per-person setting on the People screen).
    const retention = h('select', { class: 'form-select', id: 'inst-retention-input' },
      ...[[1, '1 day (smallest storage)'], [7, '7 days (recommended)'], [30, '30 days'], [90, '90 days']].map(([v, l]) => h('option', { value: String(v) }, l)));
    retention.value = String(inst.gpsRetentionDays || 7);
    const err = h('div', { class: 'form-error hidden', role: 'alert' });
    const save = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
    [name, logo, phone, email, address].forEach((el) => el.addEventListener('input', () => { err.classList.add('hidden'); paintPreview(name.value || inst.name, logo.value.trim()); }));

    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) { err.textContent = 'Institution name is required.'; err.classList.remove('hidden'); name.focus(); return; }
      if (logo.value.trim() && !/^https?:\/\//i.test(logo.value.trim())) { err.textContent = 'The logo address must start with http:// or https://.'; err.classList.remove('hidden'); logo.focus(); return; }
      save.disabled = true; save.textContent = 'Saving…';
      try {
        const updated = await Api.put('/fleet/institution', {
          name: name.value.trim(), logoUrl: logo.value.trim() || null,
          contactPhone: phone.value, contactEmail: email.value, contactAddress: address.value, trackingType: type.value,
          ...(Tenant.isFleet() ? { gpsRetentionDays: Number(retention.value) } : {}),
        });
        invalidate();
        window.dispatchEvent(new CustomEvent('fs:institution-changed', { detail: updated }));
        Toast.success('Institution updated.');
        if (updated.trackingType !== inst.trackingType) {
          // The sidebar and screens depend on the type, so rebuild the console.
          Auth.save(Auth.token(), { ...Auth.user(), trackingType: updated.trackingType });
          location.hash = ''; setTimeout(() => location.reload(), 400);
        }
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
      finally { save.disabled = false; save.textContent = 'Save changes'; }
    } },
      h('div', { class: 'flex items-center gap-4 mb-4' }, preview, h('div', {}, h('div', { class: 'cell-main' }, 'Branding'), h('div', { class: 'cell-sub' }, 'Shown in the console sidebar.'))),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: 'inst-name-input' }, 'Institution name *'), name),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: 'inst-logo-input' }, 'Logo URL'), logo, logoNote),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: 'inst-type-input' }, 'What you track'), type,
        h('div', { class: 'form-hint' }, 'Decides which screens you see. Switching never deletes data; the other screens are just hidden.')),
      Tenant.isFleet() ? h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: 'inst-retention-input' }, 'Keep GPS history for'), retention,
        h('div', { class: 'form-hint' }, 'Older GPS points are deleted automatically, which keeps storage small. Trip summaries (distance, time, driver, route, fuel and costs) are always kept, but trip replay only works within this window. Trips still running are never cut.')) : null,
      h('div', { class: 'cell-main mt-4' }, 'Contact us'),
      h('div', { class: 'cell-sub mb-2' }, 'Drivers and passengers see these in the mobile app.'),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: 'inst-phone-input' }, 'Phone'), phone),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: 'inst-email-input' }, 'Email'), email),
      h('div', { class: 'form-group' }, h('label', { class: 'form-label', for: 'inst-address-input' }, 'Address'), address),
      err, h('div', { class: 'mt-4' }, save));

    return h('div', {}, pageHead({ title: 'Institution', subtitle: 'Your organisation on FleetSync.' }),
      h('div', { class: 'grid-2' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Details')), form),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Identifiers')),
          kv([['Slug', inst.slug], ['Institution ID', h('code', { class: 'text-sm', style: { wordBreak: 'break-all' } }, inst.id)]]),
          h('p', { class: 'text-muted mt-4' }, 'The slug and ID are fixed and used by the apps to find your institution.'))));
  },
};
